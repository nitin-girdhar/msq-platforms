import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { tenantQuerySchema } from './departments.schema.js';
import { DepartmentsController } from './departments.controller.js';

export async function departmentsRouter(app: FastifyInstance) {
  const ctrl = new DepartmentsController();

  app.get('/departments', { preHandler: [authenticate, validate({ query: tenantQuerySchema })] }, ctrl.list);
}
