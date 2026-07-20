import type { FastifyInstance } from 'fastify';
import { authenticateSuperAdmin } from '../../../middleware/super-admin.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createTaskRoleSchema,
  updateTaskRoleSchema,
  tenantScopedQuerySchema,
} from './task-roles.schema.js';
import { TaskRolesController } from './task-roles.controller.js';

export async function taskRolesRouter(app: FastifyInstance) {
  const ctrl = new TaskRolesController();

  app.get('/lookups/task-roles', { preHandler: [authenticateSuperAdmin, validate({ query: tenantScopedQuerySchema })] }, ctrl.list);
  app.post('/lookups/task-roles', {
    preHandler: [authenticateSuperAdmin, validate({ body: createTaskRoleSchema, query: tenantScopedQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/task-roles/:id', {
    preHandler: [authenticateSuperAdmin, validate({ body: updateTaskRoleSchema, query: tenantScopedQuerySchema })],
  }, ctrl.update);
}
