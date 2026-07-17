import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createLeadStageSchema, updateLeadStageSchema } from './lead-stage.schema.js';
import { LeadStageController } from './lead-stage.controller.js';

export async function leadStageRouter(app: FastifyInstance) {
  const ctrl = new LeadStageController();

  app.get('/lookups/lead-stage',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/lead-stage',      { preHandler: [authenticate, validate({ body: createLeadStageSchema })] }, ctrl.create);
  app.patch('/lookups/lead-stage/:id', { preHandler: [authenticate, validate({ body: updateLeadStageSchema })] }, ctrl.update);
}
