import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createFollowUpStatusSchema, updateFollowUpStatusSchema } from './follow-up-statuses.schema.js';
import { FollowUpStatusesController } from './follow-up-statuses.controller.js';

export async function followUpStatusesRouter(app: FastifyInstance) {
  const ctrl = new FollowUpStatusesController();

  app.get('/lookups/follow-up-statuses',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/follow-up-statuses',      { preHandler: [authenticate, validate({ body: createFollowUpStatusSchema })] }, ctrl.create);
  app.patch('/lookups/follow-up-statuses/:id', { preHandler: [authenticate, validate({ body: updateFollowUpStatusSchema })] }, ctrl.update);
}
