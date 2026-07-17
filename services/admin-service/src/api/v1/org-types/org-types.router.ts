import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createOrgTypeSchema, updateOrgTypeSchema } from './org-types.schema.js';
import { OrgTypesController } from './org-types.controller.js';

export async function orgTypesRouter(app: FastifyInstance) {
  const ctrl = new OrgTypesController();

  app.get('/lookups/org-types',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/org-types',      { preHandler: [authenticate, validate({ body: createOrgTypeSchema })] }, ctrl.create);
  app.patch('/lookups/org-types/:id', { preHandler: [authenticate, validate({ body: updateOrgTypeSchema })] }, ctrl.update);
}
