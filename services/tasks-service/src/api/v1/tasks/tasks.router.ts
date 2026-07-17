import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { requireModule } from '../../../middleware/require-module.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import { TasksController } from './tasks.controller.js';
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksSchema,
  listMineTasksSchema,
  createTaskCommentSchema,
  idParamSchema,
} from './tasks.schema.js';

const ctrl = new TasksController();

// Every route behind requireModule('tasks'). Gateway maps /tasks* → /api/v1/tasks*.
export async function tasksRouter(app: FastifyInstance) {
  const gate = [authenticate, requireModule('tasks')] as const;

  // '/tasks/mine' must be registered before '/tasks/:id' so 'mine' is not captured as an id.
  app.get('/tasks/mine', { preHandler: [...gate, validate({ query: listMineTasksSchema })] }, ctrl.mine);

  app.get('/tasks', { preHandler: [...gate, validate({ query: listTasksSchema })] }, ctrl.list);
  app.post('/tasks', { preHandler: [...gate, validate({ body: createTaskSchema })] }, ctrl.create);

  app.get('/tasks/:id', { preHandler: [...gate, validate({ params: idParamSchema })] }, ctrl.getById);
  app.patch('/tasks/:id', { preHandler: [...gate, validate({ params: idParamSchema, body: updateTaskSchema })] }, ctrl.update);
  app.delete('/tasks/:id', { preHandler: [...gate, validate({ params: idParamSchema })] }, ctrl.remove);

  app.get('/tasks/:id/comments', { preHandler: [...gate, validate({ params: idParamSchema })] }, ctrl.listComments);
  app.post('/tasks/:id/comments', { preHandler: [...gate, validate({ params: idParamSchema, body: createTaskCommentSchema })] }, ctrl.addComment);

  app.get('/tasks/:id/status-history', { preHandler: [...gate, validate({ params: idParamSchema })] }, ctrl.statusHistory);
}
