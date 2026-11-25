import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class MailDeliveryError extends Error {
  constructor(code, message, { status = undefined } = {}) {
    super(message);
    this.name = 'MailDeliveryError';
    this.code = code;
    this.status = status;
  }
}

export function createMailer(config, logger, { fetchImpl = fetch } = {}) {
  const timeoutMs = config.mailTimeoutMs || 10_000;

  async function sendPasswordResetEmail({ to, name, resetUrl, expiresMinutes }) {
    const subject = 'Recuperación de contraseña — Entre Líneas';
    const textBody = [
      `Hola ${name},`,
      '',
      'Recibimos una solicitud para restablecer tu contraseña en Entre Líneas — Diario Seguro.',
      `Este enlace caduca en ${expiresMinutes} minutos y solo puede utilizarse una vez:`,
      '',
      resetUrl,
      '',
      'Si no realizaste esta solicitud, puedes ignorar este mensaje.',
    ].join('\n');

    if (config.mailDriver === 'local') {
      await fs.mkdir(config.devMailDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}_${randomUUID().slice(0, 8)}.txt`;
      const fullPath = path.join(config.devMailDir, filename);

      const content = [
        `From: ${config.mailFrom}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        '',
        textBody,
        '',
      ].join('\n');

      await fs.writeFile(fullPath, content, { encoding: 'utf8', mode: 0o600 });
      logger?.info(
        { mailDriver: 'local', dir: config.devMailDir, file: filename },
        'Correo de recuperación guardado en buzón local'
      );
      return { delivered: true, driver: 'local', file: filename, fullPath };
    }

    if (config.mailDriver === 'https-api') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(config.mailApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.mailApiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            from: config.mailFrom,
            to,
            subject,
            text: textBody,
          }),
        });

        if (!response.ok) {
          logger?.error(
            { mailDriver: 'https-api', status: response.status, reasonCode: 'MAIL_PROVIDER_ERROR' },
            'Fallo al enviar correo por API HTTPS'
          );
          throw new MailDeliveryError('MAIL_PROVIDER_ERROR', 'El proveedor de correo devolvió un error.', {
            status: response.status,
          });
        }

        logger?.info({ mailDriver: 'https-api' }, 'Correo de recuperación enviado vía API HTTPS');
        return { delivered: true, driver: 'https-api' };
      } catch (err) {
        if (err instanceof MailDeliveryError) {
          throw err;
        }
        const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError' || controller.signal.aborted;
        const reasonCode = isTimeout ? 'MAIL_TIMEOUT' : 'MAIL_NETWORK_ERROR';
        logger?.error(
          { mailDriver: 'https-api', reasonCode },
          isTimeout ? 'Timeout al contactar proveedor HTTPS de correo' : 'Error de red al contactar proveedor HTTPS de correo'
        );
        throw new MailDeliveryError(
          reasonCode,
          isTimeout ? 'Tiempo de espera agotado al entregar correo.' : 'Error de red al entregar correo.'
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw new MailDeliveryError('MAIL_DRIVER_UNSUPPORTED', `Controlador de correo no soportado: ${config.mailDriver}`);
  }

  return Object.freeze({
    sendPasswordResetEmail,
  });
}
