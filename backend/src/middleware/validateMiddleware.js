import { AppError } from '../services/errors.js';

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_form';
        if (!fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      return next(
        new AppError(400, 'Revisa los datos ingresados.', {
          code: 'VALIDATION_ERROR',
          details: { fieldErrors },
        })
      );
    }
    req.validatedBody = result.data;
    return next();
  };
}

export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(
        new AppError(400, 'Parámetros de consulta inválidos.', {
          code: 'VALIDATION_ERROR',
        })
      );
    }
    req.validatedQuery = result.data;
    return next();
  };
}

export function validateUuidParam(paramName, schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params[paramName]);
    if (!result.success) {
      return next(new AppError(400, 'Identificador inválido.', { code: 'INVALID_ID' }));
    }
    return next();
  };
}
