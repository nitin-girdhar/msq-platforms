import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './departments.service.js';
import type { TenantQuery, CreateDepartmentInput, UpdateDepartmentInput } from './departments.schema.js';

export class DepartmentsController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { tenant_id } = request.query as TenantQuery;
    const data = await service.list(tenant_id);
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { tenant_id } = request.query as TenantQuery;
    const data = await service.create(tenant_id, request.body as CreateDepartmentInput);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { tenant_id } = request.query as TenantQuery;
    const { id } = request.params as { id: string };
    const data = await service.update(tenant_id, id, request.body as UpdateDepartmentInput);
    return reply.send({ success: true, data });
  };
}
