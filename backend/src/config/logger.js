import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'entre-lineas-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.passwordHash',
        '*.password_hash',
        '*.token',
        '*.resetToken',
        '*.csrfToken',
        '*.cookie',
        '*.ciphertext',
        '*.title',
        '*.content',
        '*.phone',
        '*.sensitiveNote',
        '*.encryptionKeys',
      ],
      censor: '[REDACTADO]',
    },
  });
}
