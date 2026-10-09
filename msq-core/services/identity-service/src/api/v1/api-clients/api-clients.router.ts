import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { createApiClientSchema, updateApiClientSchema } from '@platform/validation';
import { ApiClientsController } from './api-clients.controller.js';

// A non-uuid :id is a 422 here, not a Postgres 22P02 surfacing as a bare 500.
const idParams = z.object({ id: z.string().uuid() });

export async function apiClientsRouter(app: FastifyInstance) {
  const ctrl = new ApiClientsController();

  app.get('/api-clients',    { preHandler: [authenticate] }, ctrl.list);
  app.post('/api-clients',   { preHandler: [authenticate, validate({ body: createApiClientSchema })] }, ctrl.create);
  app.patch('/api-clients/:id', { preHandler: [authenticate, validate({ params: idParams, body: updateApiClientSchema })] }, ctrl.update);
  app.post('/api-clients/:id/rotate', { preHandler: [authenticate, validate({ params: idParams })] }, ctrl.rotate);
  app.delete('/api-clients/:id',      { preHandler: [authenticate, validate({ params: idParams })] }, ctrl.revoke);
}
