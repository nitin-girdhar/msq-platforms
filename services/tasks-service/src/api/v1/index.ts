import type { FastifyInstance } from 'fastify';
import { taskListsRouter } from './task-lists/task-lists.router.js';
import { tasksRouter } from './tasks/tasks.router.js';
// Tenant-scoped lookup/role admin (N-6): super_admin manages Task reference data
// within a selected tenant. Moved here from admin-service so the write executes
// in the schema-owning service under tenant RLS (never root_service).
import { taskStatusesRouter } from './task-statuses/task-statuses.router.js';
import { taskPrioritiesRouter } from './task-priorities/task-priorities.router.js';
import { taskRolesRouter } from './task-roles/task-roles.router.js';

export async function v1Router(app: FastifyInstance) {
  await app.register(taskListsRouter);
  await app.register(tasksRouter);
  await app.register(taskStatusesRouter);
  await app.register(taskPrioritiesRouter);
  await app.register(taskRolesRouter);
}
