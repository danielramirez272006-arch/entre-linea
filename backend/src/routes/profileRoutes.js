import { Router } from 'express';
import { profileUpdateSchema } from '../validators/schemas.js';
import { validateBody } from '../middleware/validateMiddleware.js';

export function createProfileRoutes({ profileController, sessionMw }) {
  const router = Router();

  router.use(sessionMw.requireAuth);

  router.get('/', profileController.get);
  router.put('/', validateBody(profileUpdateSchema), profileController.update);

  return router;
}
