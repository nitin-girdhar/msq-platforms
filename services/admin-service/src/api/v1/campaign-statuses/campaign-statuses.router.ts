import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createCampaignStatusSchema, updateCampaignStatusSchema } from './campaign-statuses.schema.js';
import { CampaignStatusesController } from './campaign-statuses.controller.js';

export async function campaignStatusesRouter(app: FastifyInstance) {
  const ctrl = new CampaignStatusesController();

  app.get('/lookups/campaign-statuses',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/campaign-statuses',      { preHandler: [authenticate, validate({ body: createCampaignStatusSchema })] }, ctrl.create);
  app.patch('/lookups/campaign-statuses/:id', { preHandler: [authenticate, validate({ body: updateCampaignStatusSchema })] }, ctrl.update);
}
