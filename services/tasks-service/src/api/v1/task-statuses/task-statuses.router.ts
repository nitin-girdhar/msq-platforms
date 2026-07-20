import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createTaskStatusSchema,
  updateTaskStatusSchema,
  tenantScopedQuerySchema,
} from './task-statuses.schema.js';
import { TaskStatusesController } from './task-statuses.controller.js';

export async function taskStatusesRouter(app: FastifyInstance) {
  const ctrl = new TaskStatusesController();

  app.get('/lookups/task-statuses', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/task-statuses', {
    preHandler: [authenticateSuperAdmin, validate({ body: createTaskStatusSchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/task-statuses/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateTaskStatusSchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
