import { Router } from 'express';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '../validators/schemas.js';
import { validateBody } from '../middleware/validateMiddleware.js';

export function createAuthRoutes({ authController, sessionMw, authRateLimiter }) {
  const router = Router();

  router.get('/me', authController.me);
  router.post('/register', authRateLimiter, validateBody(registerSchema), authController.register);
  router.post('/login', authRateLimiter, validateBody(loginSchema), authController.login);
  router.post('/logout', sessionMw.requireAuth, authController.logout);
  router.post(
    '/forgot-password',
    authRateLimiter,
    validateBody(forgotPasswordSchema),
    authController.forgotPassword
  );
  router.post(
    '/reset-password',
    authRateLimiter,
    validateBody(resetPasswordSchema),
    authController.resetPassword
  );
  router.post(
    '/change-password',
    sessionMw.requireAuth,
    validateBody(changePasswordSchema),
    authController.changePassword
  );

  return router;
}
