import type { FastifyInstance } from 'fastify';
import { taskListsRouter } from './task-lists/task-lists.router.js';
import { tasksRouter } from './tasks/tasks.router.js';

export async function v1Router(app: FastifyInstance) {
  await app.register(taskListsRouter);
  await app.register(tasksRouter);
}
