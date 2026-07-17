import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createTaskPrioritySchema, updateTaskPrioritySchema } from './task-priorities.schema.js';
import { TaskPrioritiesController } from './task-priorities.controller.js';

export async function taskPrioritiesRouter(app: FastifyInstance) {
  const ctrl = new TaskPrioritiesController();

  app.get('/lookups/task-priorities',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/task-priorities',      { preHandler: [authenticate, validate({ body: createTaskPrioritySchema })] }, ctrl.create);
  app.patch('/lookups/task-priorities/:id', { preHandler: [authenticate, validate({ body: updateTaskPrioritySchema })] }, ctrl.update);
}
