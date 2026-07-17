import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createMarketingPlatformSchema, updateMarketingPlatformSchema } from './marketing-platforms.schema.js';
import { MarketingPlatformsController } from './marketing-platforms.controller.js';

export async function marketingPlatformsRouter(app: FastifyInstance) {
  const ctrl = new MarketingPlatformsController();

  app.get('/lookups/marketing-platforms',       { preHandler: [authenticate] }, ctrl.list);
  app.post('/lookups/marketing-platforms',      { preHandler: [authenticate, validate({ body: createMarketingPlatformSchema })] }, ctrl.create);
  app.patch('/lookups/marketing-platforms/:id', { preHandler: [authenticate, validate({ body: updateMarketingPlatformSchema })] }, ctrl.update);
}
