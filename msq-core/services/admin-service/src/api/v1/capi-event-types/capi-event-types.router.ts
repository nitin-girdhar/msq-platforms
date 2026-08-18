import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createCapiEventTypeSchema, updateCapiEventTypeSchema } from './capi-event-types.schema.js';
import { CapiEventTypesController } from './capi-event-types.controller.js';

export async function capiEventTypesRouter(app: FastifyInstance) {
  const ctrl = new CapiEventTypesController();

  app.get('/lookups/capi-event-types',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/capi-event-types',      { preHandler: [authenticate, validate({ body: createCapiEventTypeSchema })] }, ctrl.create);
  app.patch('/lookups/capi-event-types/:id', { preHandler: [authenticate, validate({ body: updateCapiEventTypeSchema })] }, ctrl.update);
}
