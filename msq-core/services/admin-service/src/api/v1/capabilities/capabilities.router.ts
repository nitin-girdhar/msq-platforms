import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { tenantQuerySchema, roleIdParamsSchema, putGrantsSchema } from './capabilities.schema.js';
import { CapabilitiesController } from './capabilities.controller.js';

export async function capabilitiesRouter(app: FastifyInstance) {
  const ctrl = new CapabilitiesController();

  app.get('/capabilities', { preHandler: [authenticate] }, ctrl.list);

  app.get(
    '/roles/:id/capabilities',
    { preHandler: [authenticate, validate({ params: roleIdParamsSchema, query: tenantQuerySchema })] },
    ctrl.listForRole,
  );

  app.put(
    '/roles/:id/capabilities',
    { preHandler: [authenticate, validate({ params: roleIdParamsSchema, body: putGrantsSchema })] },
    ctrl.putGrants,
  );
}
