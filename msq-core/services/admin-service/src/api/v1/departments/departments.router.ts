import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  tenantQuerySchema,
  createDepartmentSchema,
  updateDepartmentSchema,
} from './departments.schema.js';
import { DepartmentsController } from './departments.controller.js';

// Served under /lookups/* like every other tenant-scoped lookup, so the admin
// console's generic [table] grid reaches it with no special-casing. It used to
// sit at a bare /departments purely because it was read-only and existed only
// to fill the User Roles dropdown; now that it is writable it follows the
// convention. FkSelect's `departments` endpoint points here too.
export async function departmentsRouter(app: FastifyInstance) {
  const ctrl = new DepartmentsController();

  app.get('/lookups/departments', {
    preHandler: [authenticate, validate({ query: tenantQuerySchema })],
  }, ctrl.list);
  app.post('/lookups/departments', {
    preHandler: [authenticate, validate({ body: createDepartmentSchema, query: tenantQuerySchema })],
  }, ctrl.create);
  app.patch('/lookups/departments/:id', {
    preHandler: [authenticate, validate({ body: updateDepartmentSchema, query: tenantQuerySchema })],
  }, ctrl.update);
}
