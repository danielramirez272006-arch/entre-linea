import { setSessionCookie, clearSessionCookie } from '../middleware/sessionMiddleware.js';

export function createAuthController({ config, authService }) {
  return Object.freeze({
    async me(req, res) {
      if (!req.auth) {
        return res.status(200).json({
          authenticated: false,
          sessionExpired: Boolean(req.sessionExpired),
          user: null,
          csrfToken: null,
        });
      }
      return res.status(200).json({
        authenticated: true,
        sessionExpired: false,
        user: req.auth.user,
        csrfToken: req.auth.csrfToken,
      });
    },

    async register(req, res) {
      const result = await authService.register(req.validatedBody, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestPath: req.originalUrl,
      });
      setSessionCookie(res, config, result.sessionToken);
      return res.status(201).json({
        user: result.user,
        csrfToken: result.csrfToken,
      });
    },

    async login(req, res) {
      const result = await authService.login(req.validatedBody, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestPath: req.originalUrl,
        existingSessionIdHash: req.auth?.sessionIdHash || null,
      });
      setSessionCookie(res, config, result.sessionToken);
      return res.status(200).json({
        user: result.user,
        csrfToken: result.csrfToken,
      });
    },

    async logout(req, res) {
      await authService.logout({
        sessionIdHash: req.auth?.sessionIdHash || null,
        actorUserId: req.auth?.user?.id || null,
        ipAddress: req.ip,
        requestPath: req.originalUrl,
      });
      clearSessionCookie(res, config);
      return res.status(200).json({ ok: true });
    },

    async forgotPassword(req, res) {
      const result = await authService.requestPasswordReset(req.validatedBody, {
        ipAddress: req.ip,
        requestPath: req.originalUrl,
      });
      return res.status(200).json(result);
    },

    async resetPassword(req, res) {
      const result = await authService.resetPassword(req.validatedBody, {
        ipAddress: req.ip,
        requestPath: req.originalUrl,
      });
      clearSessionCookie(res, config);
      return res.status(200).json(result);
    },

    async changePassword(req, res) {
      const result = await authService.changePassword(
        {
          userId: req.auth.user.id,
          currentPassword: req.validatedBody.currentPassword,
          newPassword: req.validatedBody.newPassword,
        },
        {
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          requestPath: req.originalUrl,
        }
      );
      setSessionCookie(res, config, result.sessionToken);
      return res.status(200).json({
        message: result.message,
        csrfToken: result.csrfToken,
      });
    },
  });
}
