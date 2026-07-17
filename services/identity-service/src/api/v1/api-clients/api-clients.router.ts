import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createApiClientSchema, updateApiClientSchema } from '@crm/validation';
import { ApiClientsController } from './api-clients.controller.js';

export async function apiClientsRouter(app: FastifyInstance) {
  const ctrl = new ApiClientsController();

  app.get('/api-clients',    { preHandler: [authenticate] }, ctrl.list);
  app.post('/api-clients',   { preHandler: [authenticate, validate({ body: createApiClientSchema })] }, ctrl.create);
  app.patch('/api-clients/:id', { preHandler: [authenticate, validate({ body: updateApiClientSchema })] }, ctrl.update);
  app.post('/api-clients/:id/rotate', { preHandler: [authenticate] }, ctrl.rotate);
  app.delete('/api-clients/:id',      { preHandler: [authenticate] }, ctrl.revoke);
}
