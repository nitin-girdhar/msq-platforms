import type { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './task-lists.service.js';
import type { TaskCtx } from './task-lists.repository.js';
import type { CreateTaskListInput, UpdateTaskListInput, ListTaskListsInput } from '@crm/validation';

function ctxOf(request: FastifyRequest): TaskCtx {
  const { org_id, user_id, role, tenant_id, rank } = request.auth;
  return { org_id, user_id, role, tenant_id, rank };
}

export class TaskListsController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.listTaskLists(ctxOf(request), request.query as ListTaskListsInput);
    return reply.send({ success: true, ...result });
  };

  getById = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const data = await service.getTaskList(ctxOf(request), id);
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await service.createTaskList(ctxOf(request), request.body as CreateTaskListInput);
    return reply.status(201).send({ success: true, data: result });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.updateTaskList(ctxOf(request), id, request.body as UpdateTaskListInput);
    return reply.status(204).send();
  };

  remove = async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await service.deleteTaskList(ctxOf(request), id);
    return reply.status(204).send();
  };
}
