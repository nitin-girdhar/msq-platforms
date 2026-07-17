import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { requireModule } from '../../../middleware/require-module.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { TaskListsController } from './task-lists.controller.js';
import { createTaskListSchema, updateTaskListSchema, listTaskListsSchema, idParamSchema } from './task-lists.schema.js';

const ctrl = new TaskListsController();

// Every route behind requireModule('tasks'). Gateway maps /task-lists* →
// /api/v1/task-lists*.
export async function taskListsRouter(app: FastifyInstance) {
  const gate = [authenticate, requireModule('tasks')] as const;

  app.get('/task-lists', { preHandler: [...gate, validate({ query: listTaskListsSchema })] }, ctrl.list);
  app.post('/task-lists', { preHandler: [...gate, validate({ body: createTaskListSchema })] }, ctrl.create);
  app.get('/task-lists/:id', { preHandler: [...gate, validate({ params: idParamSchema })] }, ctrl.getById);
  app.patch('/task-lists/:id', { preHandler: [...gate, validate({ params: idParamSchema, body: updateTaskListSchema })] }, ctrl.update);
  app.delete('/task-lists/:id', { preHandler: [...gate, validate({ params: idParamSchema })] }, ctrl.remove);
}
