import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class MailDeliveryError extends Error {
  constructor(code, message, { status = undefined, providerCode = undefined } = {}) {
    super(message);
    this.name = 'MailDeliveryError';
    this.code = code;
    this.status = status;
    this.providerCode = providerCode;
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

    if (config.mailDriver === 'https-api' || config.mailDriver === 'brevo') {
      const targetUrl = (
        config.mailApiUrl || (config.mailDriver === 'brevo' ? 'https://api.brevo.com/v3/smtp/email' : '')
      ).trim();

      const isBrevo =
        config.mailDriver === 'brevo' ||
        (() => {
          try {
            return new URL(targetUrl).hostname.toLowerCase().endsWith('brevo.com');
          } catch {
            return false;
          }
        })();

      const headers = isBrevo
        ? {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'api-key': config.mailApiKey,
          }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.mailApiKey}`,
          };

      const bodyPayload = isBrevo
        ? {
            sender: {
              name: 'Entre Líneas',
              email: config.mailFrom,
            },
            to: [{ email: to }],
            subject,
            textContent: textBody,
          }
        : {
            from: config.mailFrom,
            to,
            subject,
            text: textBody,
          };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(targetUrl, {
          method: 'POST',
          headers,
          signal: controller.signal,
          redirect: 'error',
          body: JSON.stringify(bodyPayload),
        });

        if (!response.ok) {
          let providerCode;
          try {
            const errJson = typeof response.json === 'function' ? await response.json() : null;
            if (errJson && typeof errJson.code === 'string') {
              providerCode = errJson.code.slice(0, 64);
            }
          } catch {
            // Ignora cuerpo no JSON; nunca registramos el cuerpo completo.
          }

          logger?.error(
            {
              mailDriver: config.mailDriver,
              provider: isBrevo ? 'brevo' : 'https-api',
              status: response.status,
              providerCode,
              reasonCode: 'MAIL_PROVIDER_ERROR',
            },
            'Fallo al enviar correo por API HTTPS'
          );
          throw new MailDeliveryError('MAIL_PROVIDER_ERROR', 'El proveedor de correo devolvió un error.', {
            status: response.status,
            providerCode,
          });
        }

        logger?.info(
          { mailDriver: config.mailDriver, provider: isBrevo ? 'brevo' : 'https-api' },
          'Correo de recuperación enviado vía API HTTPS'
        );
        return { delivered: true, driver: isBrevo ? 'brevo' : 'https-api' };
      } catch (err) {
        if (err instanceof MailDeliveryError) {
          throw err;
        }
        const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError' || controller.signal.aborted;
        const reasonCode = isTimeout ? 'MAIL_TIMEOUT' : 'MAIL_NETWORK_ERROR';
        logger?.error(
          { mailDriver: config.mailDriver, provider: isBrevo ? 'brevo' : 'https-api', reasonCode },
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
