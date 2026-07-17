import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createTaskStatusSchema, updateTaskStatusSchema } from './task-statuses.schema.js';
import { TaskStatusesController } from './task-statuses.controller.js';

export async function taskStatusesRouter(app: FastifyInstance) {
  const ctrl = new TaskStatusesController();

  app.get('/lookups/task-statuses',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/task-statuses',      { preHandler: [authenticate, validate({ body: createTaskStatusSchema })] }, ctrl.create);
  app.patch('/lookups/task-statuses/:id', { preHandler: [authenticate, validate({ body: updateTaskStatusSchema })] }, ctrl.update);
}
