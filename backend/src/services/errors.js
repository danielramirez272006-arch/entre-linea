export class AppError extends Error {
  constructor(statusCode, message, { code = 'APP_ERROR', details = undefined, retryAfterSeconds = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
