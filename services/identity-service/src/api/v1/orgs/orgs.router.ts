import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { getOrgsQuerySchema, updateOrgGeoSchema } from './orgs.schema.js';
import { OrgsController } from './orgs.controller.js';

export async function orgsRouter(app: FastifyInstance) {
  const ctrl = new OrgsController();

  app.get('/orgs',         { preHandler: [authenticate, validate({ query: getOrgsQuerySchema })] }, ctrl.getOrgs);
  app.get('/orgs/all',     { preHandler: [authenticate] }, ctrl.getAllOrgs);
  app.patch('/orgs/:id',   { preHandler: [authenticate, validate({ body: updateOrgGeoSchema })] }, ctrl.updateOrgGeo);
  app.get('/lead-sources', { preHandler: [authenticate] }, ctrl.getLeadSources);
}
