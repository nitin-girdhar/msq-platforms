import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { tenantIdParamSchema, putTenantModulesSchema } from './tenant-modules.schema.js';
import { TenantModulesController } from './tenant-modules.controller.js';

export async function tenantModulesRouter(app: FastifyInstance) {
  const ctrl = new TenantModulesController();

  app.get('/tenants/:id/modules', {
    preHandler: [authenticate, validate({ params: tenantIdParamSchema })],
  }, ctrl.list);
  app.put('/tenants/:id/modules', {
    preHandler: [authenticate, validate({ params: tenantIdParamSchema, body: putTenantModulesSchema })],
  }, ctrl.put);
}
