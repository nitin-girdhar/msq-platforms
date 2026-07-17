import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createUserSchema, updateUserSchema, createResetPasswordSchema, updateAssignmentWeightsSchema, addOrgMappingSchema } from '@crm/validation';
import { listUsersQuerySchema, getAssignableQuerySchema } from './users.schema.js';
import { UsersController } from './users.controller.js';
import { config } from '../../../config/index.js';

export async function usersRouter(app: FastifyInstance) {
  const ctrl = new UsersController();
  const resetPasswordSchema = createResetPasswordSchema(config.passwordMinLength);

  app.get('/users',            { preHandler: [authenticate, validate({ query: listUsersQuerySchema })] }, ctrl.list);
  app.get('/users/assignable', { preHandler: [authenticate, validate({ query: getAssignableQuerySchema })] }, ctrl.getAssignable);
  app.get('/users/assignment-weights', { preHandler: [authenticate] }, ctrl.getAssignmentWeights);
  app.put('/users/assignment-weights', { preHandler: [authenticate, validate({ body: updateAssignmentWeightsSchema })] }, ctrl.updateAssignmentWeights);
  app.get('/users/team',       { preHandler: [authenticate] }, ctrl.getTeam);
  app.get('/users/org-chart',  { preHandler: [authenticate] }, ctrl.getOrgChart);
  app.get('/users/:id',        { preHandler: [authenticate] }, ctrl.getById);
  app.post('/users',           { preHandler: [authenticate, validate({ body: createUserSchema })] }, ctrl.create);
  app.patch('/users/:id',      { preHandler: [authenticate, validate({ body: updateUserSchema })] }, ctrl.update);
  app.delete('/users/:id',     { preHandler: [authenticate] }, ctrl.delete);
  app.post('/users/:id/reset-password', { preHandler: [authenticate, validate({ body: resetPasswordSchema })] }, ctrl.resetPassword);

  app.get('/users/:id/org-mappings',           { preHandler: [authenticate] }, ctrl.listOrgMappings);
  app.post('/users/:id/org-mappings',          { preHandler: [authenticate, validate({ body: addOrgMappingSchema })] }, ctrl.addOrgMapping);
  app.delete('/users/:id/org-mappings/:orgId', { preHandler: [authenticate] }, ctrl.removeOrgMapping);
}
