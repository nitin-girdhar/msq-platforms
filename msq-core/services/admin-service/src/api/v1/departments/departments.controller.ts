import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './departments.service.js';
import type { TenantQuery } from './departments.schema.js';

export class DepartmentsController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { tenant_id } = request.query as TenantQuery;
    const data = await service.list(tenant_id);
    return reply.send({ success: true, data });
  };
}
