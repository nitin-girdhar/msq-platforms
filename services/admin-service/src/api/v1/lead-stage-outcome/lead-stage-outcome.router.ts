import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createLeadStageOutcomeSchema, updateLeadStageOutcomeSchema } from './lead-stage-outcome.schema.js';
import { LeadStageOutcomeController } from './lead-stage-outcome.controller.js';

export async function leadStageOutcomeRouter(app: FastifyInstance) {
  const ctrl = new LeadStageOutcomeController();

  app.get('/lookups/lead-stage-outcome',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/lead-stage-outcome',      { preHandler: [authenticate, validate({ body: createLeadStageOutcomeSchema })] }, ctrl.create);
  app.patch('/lookups/lead-stage-outcome/:id', { preHandler: [authenticate, validate({ body: updateLeadStageOutcomeSchema })] }, ctrl.update);
}
