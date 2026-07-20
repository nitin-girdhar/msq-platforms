import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createTenantSchema, updateTenantSchema } from './tenants.schema.js';
import { TenantsController } from './tenants.controller.js';

export async function tenantsRouter(app: FastifyInstance) {
  const ctrl = new TenantsController();

  app.get('/lookups/tenants',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/tenants',      { preHandler: [authenticate, validate({ body: createTenantSchema })] }, ctrl.create);
  app.patch('/lookups/tenants/:id', { preHandler: [authenticate, validate({ body: updateTenantSchema })] }, ctrl.update);
}
