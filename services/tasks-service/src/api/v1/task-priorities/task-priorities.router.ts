import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createTaskPrioritySchema,
  updateTaskPrioritySchema,
  tenantScopedQuerySchema,
} from './task-priorities.schema.js';
import { TaskPrioritiesController } from './task-priorities.controller.js';

export async function taskPrioritiesRouter(app: FastifyInstance) {
  const ctrl = new TaskPrioritiesController();

  app.get('/lookups/task-priorities', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/task-priorities', {
    preHandler: [authenticateSuperAdmin, validate({ body: createTaskPrioritySchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/task-priorities/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateTaskPrioritySchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
