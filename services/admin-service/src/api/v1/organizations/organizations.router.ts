import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createOrganizationSchema, updateOrganizationSchema } from './organizations.schema.js';
import { OrganizationsController } from './organizations.controller.js';

export async function organizationsRouter(app: FastifyInstance) {
  const ctrl = new OrganizationsController();

  app.get('/lookups/organizations',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/organizations',      { preHandler: [authenticate, validate({ body: createOrganizationSchema })] }, ctrl.create);
  app.patch('/lookups/organizations/:id', { preHandler: [authenticate, validate({ body: updateOrganizationSchema })] }, ctrl.update);
}
