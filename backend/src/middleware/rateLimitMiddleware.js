import { AppError } from '../services/errors.js';

export function createRateLimiter({ rateLimitRepo, auditRepo, prefix, windowMs, maxRequests, message }) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const key = `${prefix}:${req.ip || 'unknown'}`;
      const { hitCount, windowResetAt } = await rateLimitRepo.consumeHit(key, windowMs);
      const retryAfterSeconds = Math.max(1, Math.ceil((windowResetAt.getTime() - Date.now()) / 1000));

      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - hitCount)));

      if (hitCount > maxRequests) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
        try {
          await auditRepo.insert({
            eventType: 'rate_limited',
            severity: 'warn',
            actorUserId: req.auth?.user?.id || null,
            ipAddress: req.ip,
            requestPath: req.originalUrl,
            details: { prefix, hitCount, maxRequests },
          });
        } catch {
          // No interrumpir el 429 si falla el registro.
        }
        return next(
          new AppError(
            429,
            message || 'Demasiadas solicitudes. Espera unos instantes antes de volver a intentarlo.',
            { code: 'RATE_LIMITED', retryAfterSeconds }
          )
        );
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
