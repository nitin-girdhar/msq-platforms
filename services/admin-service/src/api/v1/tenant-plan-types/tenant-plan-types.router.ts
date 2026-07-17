import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createTenantPlanTypeSchema, updateTenantPlanTypeSchema } from './tenant-plan-types.schema.js';
import { TenantPlanTypesController } from './tenant-plan-types.controller.js';

export async function tenantPlanTypesRouter(app: FastifyInstance) {
  const ctrl = new TenantPlanTypesController();

  app.get('/lookups/tenant-plan-types',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/tenant-plan-types',      { preHandler: [authenticate, validate({ body: createTenantPlanTypeSchema })] }, ctrl.create);
  app.patch('/lookups/tenant-plan-types/:id', { preHandler: [authenticate, validate({ body: updateTenantPlanTypeSchema })] }, ctrl.update);
}
