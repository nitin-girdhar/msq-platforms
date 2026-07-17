import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createLeadSourceSchema, updateLeadSourceSchema } from './lead-sources.schema.js';
import { LeadSourcesController } from './lead-sources.controller.js';

export async function leadSourcesRouter(app: FastifyInstance) {
  const ctrl = new LeadSourcesController();

  app.get('/lookups/lead-sources',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/lead-sources',      { preHandler: [authenticate, validate({ body: createLeadSourceSchema })] }, ctrl.create);
  app.patch('/lookups/lead-sources/:id', { preHandler: [authenticate, validate({ body: updateLeadSourceSchema })] }, ctrl.update);
}
