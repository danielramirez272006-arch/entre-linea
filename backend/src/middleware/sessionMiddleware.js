import { sha256Hex } from '../security/tokens.js';
import { AppError } from '../services/errors.js';

export function setSessionCookie(res, config, rawSessionToken) {
  res.cookie(config.sessionCookieName, rawSessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionTtlMs,
  });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  });
}

export function createSessionMiddleware({ config, sessionsRepo, auditRepo }) {
  async function attachSession(req, res, next) {
    try {
      const rawToken = req.cookies?.[config.sessionCookieName];
      if (!rawToken || typeof rawToken !== 'string' || rawToken.length > 128) {
        req.auth = null;
        return next();
      }

      const idHash = sha256Hex(rawToken);
      const session = await sessionsRepo.findActiveByIdHash(idHash);
      if (!session) {
        clearSessionCookie(res, config);
        req.auth = null;
        req.sessionExpired = true;
        return next();
      }

      const newExpiresAt = new Date(Date.now() + config.sessionTtlMs);
      await sessionsRepo.touch(idHash, newExpiresAt);

      req.auth = {
        sessionIdHash: session.id_hash,
        csrfToken: session.csrf_token,
        user: {
          id: session.user_id,
          name: session.name,
          email: session.email,
          role: session.role,
        },
      };
      return next();
    } catch (err) {
      return next(err);
    }
  }

  function requireAuth(req, _res, next) {
    if (!req.auth) {
      const message = req.sessionExpired
        ? 'Tu sesión ha caducado. Inicia sesión nuevamente.'
        : 'Debes iniciar sesión para continuar.';
      return next(
        new AppError(401, message, {
          code: req.sessionExpired ? 'SESSION_EXPIRED' : 'UNAUTHORIZED',
        })
      );
    }
    return next();
  }

  function requireRole(requiredRole) {
    return async (req, _res, next) => {
      if (!req.auth) {
        return next(new AppError(401, 'Debes iniciar sesión para continuar.', { code: 'UNAUTHORIZED' }));
      }
      if (req.auth.user.role !== requiredRole) {
        try {
          await auditRepo.insert({
            eventType: 'access_denied',
            severity: 'warn',
            actorUserId: req.auth.user.id,
            ipAddress: req.ip,
            requestPath: req.originalUrl,
            details: { requiredRole, actualRole: req.auth.user.role },
          });
        } catch {
          // No bloqueamos la respuesta 403 si falla el registro auxiliar.
        }
        return next(new AppError(403, 'No tienes permisos para acceder a este recurso.', { code: 'FORBIDDEN' }));
      }
      return next();
    };
  }

  return Object.freeze({
    attachSession,
    requireAuth,
    requireRole,
  });
}
