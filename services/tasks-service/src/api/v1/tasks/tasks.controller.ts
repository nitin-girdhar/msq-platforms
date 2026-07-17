import type { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './tasks.service.js';
import type { TaskCtx } from './tasks.repository.js';
import type {
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
  ListMineTasksInput,
  CreateTaskCommentInput,
} from '@crm/validation';

function ctxOf(request: FastifyRequest): TaskCtx {
  const { org_id, user_id, role, tenant_id, rank } = request.auth;
  return { org_id, user_id, role, tenant_id, rank };
}

export class TasksController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.listTasks(ctxOf(request), request.query as ListTasksInput);
    return reply.send({ success: true, ...result });
  };

  mine = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.listMine(ctxOf(request), request.query as ListMineTasksInput);
    return reply.send({ success: true, ...result });
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const data = await service.getTask(ctxOf(request), id);
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.createTask(ctxOf(request), request.body as CreateTaskInput);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const data = await service.updateTask(ctxOf(request), id, request.body as UpdateTaskInput);
    return reply.send({ success: true, data });
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.deleteTask(ctxOf(request), id);
    return reply.status(204).send();
  };

  addComment = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { body } = request.body as CreateTaskCommentInput;
    const result = await service.addComment(ctxOf(request), id, body);
    return reply.status(201).send({ success: true, data: result });
  };

  listComments = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const data = await service.listComments(ctxOf(request), id);
    return reply.send({ success: true, data });
  };

  statusHistory = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const data = await service.getStatusHistory(ctxOf(request), id);
    return reply.send({ success: true, data });
  };
}
