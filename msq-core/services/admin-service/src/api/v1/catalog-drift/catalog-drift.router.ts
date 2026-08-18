import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { CatalogDriftController } from './catalog-drift.controller.js';

export async function catalogDriftRouter(app: FastifyInstance) {
  const ctrl = new CatalogDriftController();
  app.get('/catalogs/drift', { preHandler: [authenticate] }, ctrl.list);
}
