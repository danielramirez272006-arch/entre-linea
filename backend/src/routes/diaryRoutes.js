import { Router } from 'express';
import {
  diaryCreateSchema,
  diaryUpdateSchema,
  diaryFilterSchema,
  uuidParamSchema,
} from '../validators/schemas.js';
import { validateBody, validateQuery, validateUuidParam } from '../middleware/validateMiddleware.js';

export function createDiaryRoutes({ diaryController, sessionMw }) {
  const router = Router();

  router.use(sessionMw.requireAuth);

  router.get('/', validateQuery(diaryFilterSchema), diaryController.list);
  router.post('/', validateBody(diaryCreateSchema), diaryController.create);
  router.get('/:id', validateUuidParam('id', uuidParamSchema), diaryController.getOne);
  router.put(
    '/:id',
    validateUuidParam('id', uuidParamSchema),
    validateBody(diaryUpdateSchema),
    diaryController.update
  );
  router.delete('/:id', validateUuidParam('id', uuidParamSchema), diaryController.remove);

  return router;
}
