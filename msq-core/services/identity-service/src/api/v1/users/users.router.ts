import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema, updateAssignmentWeightsSchema, addOrgMappingSchema } from '@platform/validation';
import { listUsersQuerySchema, getAssignableQuerySchema, uploadPhotoSchema, orgScopedQuerySchema } from './users.schema.js';
import { UsersController } from './users.controller.js';
import { PhotosController } from './photos.controller.js';

// Base64 photo payloads (~2.9M chars) exceed Fastify's 1 MiB default body limit.
const PHOTO_BODY_LIMIT = 4 * 1024 * 1024;

export async function usersRouter(app: FastifyInstance) {
  const ctrl = new UsersController();
  const photos = new PhotosController();

  app.get('/users',            { preHandler: [authenticate, validate({ query: listUsersQuerySchema })] }, ctrl.list);
  app.get('/users/assignable', { preHandler: [authenticate, validate({ query: getAssignableQuerySchema })] }, ctrl.getAssignable);
  app.get('/users/assignment-weights', { preHandler: [authenticate, validate({ query: orgScopedQuerySchema })] }, ctrl.getAssignmentWeights);
  // Registered before `/users/:id` so the literal segments are unambiguous.
  app.get('/users/role-catalog',       { preHandler: [authenticate] }, ctrl.getRoleCatalog);
  app.get('/users/manager-candidates', { preHandler: [authenticate, validate({ query: orgScopedQuerySchema })] }, ctrl.getManagerCandidates);
  app.put('/users/assignment-weights', { preHandler: [authenticate, validate({ body: updateAssignmentWeightsSchema })] }, ctrl.updateAssignmentWeights);
  app.get('/users/team',       { preHandler: [authenticate] }, ctrl.getTeam);
  app.get('/users/org-chart',  { preHandler: [authenticate] }, ctrl.getOrgChart);
  // Profile photo / avatar. `/users/me/photo` is self-service; `/users/:id/photo`
  // POST is admin-only (rank ceiling enforced in the service). GET is
  // authenticated + RLS-scoped and serves cacheable image bytes. Registered
  // before `/users/:id` so the literal `me` segment is unambiguous.
  app.post('/users/me/photo',  { bodyLimit: PHOTO_BODY_LIMIT, preHandler: [authenticate, validate({ body: uploadPhotoSchema })] }, photos.uploadMine);
  app.post('/users/:id/photo', { bodyLimit: PHOTO_BODY_LIMIT, preHandler: [authenticate, validate({ body: uploadPhotoSchema })] }, photos.uploadForUser);
  app.get('/users/:id/photo',  { preHandler: [authenticate] }, photos.getPhoto);

  app.get('/users/:id',        { preHandler: [authenticate] }, ctrl.getById);
  app.post('/users',           { preHandler: [authenticate, validate({ body: createUserSchema })] }, ctrl.create);
  app.patch('/users/:id',      { preHandler: [authenticate, validate({ body: updateUserSchema })] }, ctrl.update);
  app.delete('/users/:id',     { preHandler: [authenticate] }, ctrl.delete);
  app.post('/users/:id/reset-password', { preHandler: [authenticate, validate({ body: resetPasswordSchema })] }, ctrl.resetPassword);

  app.get('/users/:id/org-mappings',           { preHandler: [authenticate] }, ctrl.listOrgMappings);
  app.post('/users/:id/org-mappings',          { preHandler: [authenticate, validate({ body: addOrgMappingSchema })] }, ctrl.addOrgMapping);
  app.delete('/users/:id/org-mappings/:orgId', { preHandler: [authenticate] }, ctrl.removeOrgMapping);
}
