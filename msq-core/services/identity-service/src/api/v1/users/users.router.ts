import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema, updateAssignmentWeightsSchema, addOrgMappingSchema } from '@platform/validation';
import { listUsersQuerySchema, getAssignableQuerySchema, uploadPhotoSchema, orgScopedQuerySchema, assignmentWeightsQuerySchema, adminScopeQuerySchema } from './users.schema.js';
import { UsersController } from './users.controller.js';
import { PhotosController } from './photos.controller.js';

// Base64 photo payloads (~2.9M chars) exceed Fastify's 1 MiB default body limit.
const PHOTO_BODY_LIMIT = 4 * 1024 * 1024;

export async function usersRouter(app: FastifyInstance) {
  const ctrl = new UsersController();
  const photos = new PhotosController();

  app.get('/users',            { preHandler: [authenticate, validate({ query: listUsersQuerySchema })] }, ctrl.list);
  app.get('/users/assignable', { preHandler: [authenticate, validate({ query: getAssignableQuerySchema })] }, ctrl.getAssignable);
  app.get('/users/assignment-weights', { preHandler: [authenticate, validate({ query: assignmentWeightsQuerySchema })] }, ctrl.getAssignmentWeights);
  // Registered before `/users/:id` so the literal segments are unambiguous.
  // `?tenant_id=` (and `org_id=`) on these is lookup-admin's navbar scope,
  // honoured for super_admin only — see scopeContext in the service.
  app.get('/users/role-catalog',       { preHandler: [authenticate, validate({ query: orgScopedQuerySchema })] }, ctrl.getRoleCatalog);
  app.get('/users/campaign-type-catalog', { preHandler: [authenticate, validate({ query: orgScopedQuerySchema })] }, ctrl.getCampaignTypeCatalog);
  app.get('/users/manager-candidates', { preHandler: [authenticate, validate({ query: orgScopedQuerySchema })] }, ctrl.getManagerCandidates);
  app.put('/users/assignment-weights', { preHandler: [authenticate, validate({ body: updateAssignmentWeightsSchema, query: orgScopedQuerySchema })] }, ctrl.updateAssignmentWeights);
  app.get('/users/org-chart',  { preHandler: [authenticate, validate({ query: orgScopedQuerySchema })] }, ctrl.getOrgChart);
  // Profile photo / avatar. `/users/me/photo` is self-service; `/users/:id/photo`
  // POST is admin-only (rank ceiling enforced in the service). GET is
  // authenticated + RLS-scoped and serves cacheable image bytes. Registered
  // before `/users/:id` so the literal `me` segment is unambiguous.
  app.post('/users/me/photo',  { bodyLimit: PHOTO_BODY_LIMIT, preHandler: [authenticate, validate({ body: uploadPhotoSchema })] }, photos.uploadMine);
  app.post('/users/:id/photo', { bodyLimit: PHOTO_BODY_LIMIT, preHandler: [authenticate, validate({ body: uploadPhotoSchema })] }, photos.uploadForUser);
  app.get('/users/:id/photo',  { preHandler: [authenticate] }, photos.getPhoto);

  // `?tenant_id=&org_id=` on the by-id routes is lookup-admin's navbar scope —
  // see adminScopeQuerySchema / resolveTargetScope.
  const scoped = validate({ query: adminScopeQuerySchema });
  app.get('/users/:id',        { preHandler: [authenticate, scoped] }, ctrl.getById);
  app.post('/users',           { preHandler: [authenticate, validate({ body: createUserSchema, query: adminScopeQuerySchema })] }, ctrl.create);
  app.patch('/users/:id',      { preHandler: [authenticate, validate({ body: updateUserSchema, query: adminScopeQuerySchema })] }, ctrl.update);
  app.delete('/users/:id',     { preHandler: [authenticate, scoped] }, ctrl.delete);
  app.post('/users/:id/reset-password', { preHandler: [authenticate, validate({ body: resetPasswordSchema, query: adminScopeQuerySchema })] }, ctrl.resetPassword);

  app.get('/users/:id/org-mappings',           { preHandler: [authenticate, scoped] }, ctrl.listOrgMappings);
  app.post('/users/:id/org-mappings',          { preHandler: [authenticate, validate({ body: addOrgMappingSchema, query: adminScopeQuerySchema })] }, ctrl.addOrgMapping);
  app.delete('/users/:id/org-mappings/:orgId', { preHandler: [authenticate, scoped] }, ctrl.removeOrgMapping);
}
