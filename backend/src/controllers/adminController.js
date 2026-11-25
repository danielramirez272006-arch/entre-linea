export function createAdminController({ adminService }) {
  return Object.freeze({
    async listUsers(req, res) {
      const users = await adminService.listUsers(req.auth.user);
      return res.status(200).json({ users });
    },

    async listAuditLogs(req, res) {
      const limit = Number(req.query.limit) || 100;
      const logs = await adminService.listAuditLogs(req.auth.user, limit);
      return res.status(200).json({ logs });
    },

    async updateUserRole(req, res) {
      const user = await adminService.changeUserRole(
        req.auth.user,
        req.params.id,
        req.validatedBody,
        {
          ipAddress: req.ip,
          requestPath: req.originalUrl,
        }
      );
      return res.status(200).json({ user });
    },
  });
}
