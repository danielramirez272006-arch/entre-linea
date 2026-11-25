import { safeEqualHex } from '../security/tokens.js';
import { AppError } from '../services/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function extractOrigin(req) {
  const originHeader = req.get('origin');
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      return null;
    }
  }

  const refererHeader = req.get('referer');
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin;
    } catch {
      return null;
    }
  }

  return undefined;
}

export function createCsrfMiddleware({ config, auditRepo }) {
  const allowedOrigins = new Set([config.appOrigin]);
  // En desarrollo local, también permitimos el propio puerto del backend si sirve el build estático.
  if (!config.isProduction) {
    allowedOrigins.add(`http://localhost:${config.port}`);
    allowedOrigins.add(`http://127.0.0.1:${config.port}`);
  }

  async function verifyOrigin(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    const requestOrigin = extractOrigin(req);
    // Si viene Origin o Referer, debe coincidir exactamente con un origen autorizado.
    if (requestOrigin !== undefined && (!requestOrigin || !allowedOrigins.has(requestOrigin))) {
      try {
        await auditRepo.insert({
          eventType: 'origin_rejected',
          severity: 'warn',
          actorUserId: req.auth?.user?.id || null,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
          details: { origin: requestOrigin || 'malformed' },
        });
      } catch {
        // Ignorar fallo de auditoría en rechazo.
      }
      return next(new AppError(403, 'Origen de solicitud no autorizado.', { code: 'ORIGIN_NOT_ALLOWED' }));
    }

    return next();
  }

  async function verifyCsrf(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }
    if (!req.auth) {
      return next();
    }

    const provided = req.get('x-csrf-token');
    if (!provided || !safeEqualHex(provided, req.auth.csrfToken)) {
      try {
        await auditRepo.insert({
          eventType: 'csrf_rejected',
          severity: 'warn',
          actorUserId: req.auth.user.id,
          ipAddress: req.ip,
          requestPath: req.originalUrl,
        });
      } catch {
        // Ignorar fallo de auditoría en rechazo.
      }
      return next(
        new AppError(403, 'Token de seguridad CSRF inválido o ausente. Recarga la página e intenta de nuevo.', {
          code: 'CSRF_INVALID',
        })
      );
    }

    return next();
  }

  return Object.freeze({
    allowedOrigins,
    verifyOrigin,
    verifyCsrf,
  });
}
