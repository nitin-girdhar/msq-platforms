import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createUserRoleSchema, updateUserRoleSchema } from './user-roles.schema.js';
import { UserRolesController } from './user-roles.controller.js';

export async function userRolesRouter(app: FastifyInstance) {
  const ctrl = new UserRolesController();

  app.get('/lookups/user-roles',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/user-roles',      { preHandler: [authenticate, validate({ body: createUserRoleSchema })] }, ctrl.create);
  app.patch('/lookups/user-roles/:id', { preHandler: [authenticate, validate({ body: updateUserRoleSchema })] }, ctrl.update);
}
