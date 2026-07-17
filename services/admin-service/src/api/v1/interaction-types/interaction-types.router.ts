import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createInteractionTypeSchema, updateInteractionTypeSchema } from './interaction-types.schema.js';
import { InteractionTypesController } from './interaction-types.controller.js';

export async function interactionTypesRouter(app: FastifyInstance) {
  const ctrl = new InteractionTypesController();

  app.get('/lookups/interaction-types',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/interaction-types',      { preHandler: [authenticate, validate({ body: createInteractionTypeSchema })] }, ctrl.create);
  app.patch('/lookups/interaction-types/:id', { preHandler: [authenticate, validate({ body: updateInteractionTypeSchema })] }, ctrl.update);
}
