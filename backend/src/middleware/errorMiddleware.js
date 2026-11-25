import { AppError } from '../services/errors.js';

export function createErrorHandler(logger) {
  return function errorHandler(err, req, res, _next) {
    if (err instanceof AppError) {
      if (err.retryAfterSeconds) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      const payload = {
        error: {
          code: err.code,
          message: err.message,
        },
      };
      if (err.details) {
        payload.error.details = err.details;
      }
      return res.status(err.statusCode).json(payload);
    }

    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'El contenido enviado excede el tamaño máximo permitido.',
        },
      });
    }

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'El cuerpo de la solicitud no es un JSON válido.',
        },
      });
    }

    logger?.error(
      {
        err: {
          name: err?.name,
          message: err?.message,
          code: err?.code,
        },
        method: req.method,
        path: req.originalUrl,
      },
      'Error interno no controlado'
    );

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error interno. Intenta nuevamente más tarde.',
      },
    });
  };
}
