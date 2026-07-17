import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createTenantDomainSchema, updateTenantDomainSchema } from './tenant-domains.schema.js';
import { TenantDomainsController } from './tenant-domains.controller.js';

export async function tenantDomainsRouter(app: FastifyInstance) {
  const ctrl = new TenantDomainsController();

  app.get('/lookups/tenant-domains',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/tenant-domains',      { preHandler: [authenticate, validate({ body: createTenantDomainSchema })] }, ctrl.create);
  app.patch('/lookups/tenant-domains/:id', { preHandler: [authenticate, validate({ body: updateTenantDomainSchema })] }, ctrl.update);
}
