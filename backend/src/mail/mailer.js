import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createMailer(config, logger) {
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
      logger?.info({ mailDriver: 'local', file: filename }, 'Correo de recuperación guardado en buzón local');
      return { delivered: true, driver: 'local', file: filename };
    }

    if (config.mailDriver === 'https-api') {
      const response = await fetch(config.mailApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.mailApiKey}`,
        },
        body: JSON.stringify({
          from: config.mailFrom,
          to,
          subject,
          text: textBody,
        }),
      });

      if (!response.ok) {
        logger?.error({ status: response.status }, 'Fallo al enviar correo por API HTTPS');
        throw new Error('No se pudo entregar el correo de recuperación.');
      }

      logger?.info({ mailDriver: 'https-api' }, 'Correo de recuperación enviado vía API HTTPS');
      return { delivered: true, driver: 'https-api' };
    }

    throw new Error(`Controlador de correo no soportado: ${config.mailDriver}`);
  }

  return Object.freeze({
    sendPasswordResetEmail,
  });
}
