import { Router } from 'express';
import { adminRoleUpdateSchema, uuidParamSchema } from '../validators/schemas.js';
import { validateBody, validateUuidParam } from '../middleware/validateMiddleware.js';

export function createAdminRoutes({ adminController, sessionMw }) {
  const router = Router();

  router.use(sessionMw.requireAuth);
  router.use(sessionMw.requireRole('admin'));

  router.get('/users', adminController.listUsers);
  router.patch(
    '/users/:id/role',
    validateUuidParam('id', uuidParamSchema),
    validateBody(adminRoleUpdateSchema),
    adminController.updateUserRole
  );
  router.get('/audit-logs', adminController.listAuditLogs);

  return router;
}
