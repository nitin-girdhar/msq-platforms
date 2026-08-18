import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './tenant-modules.service.js';
import type { PutTenantModulesInput } from './tenant-modules.schema.js';

export class TenantModulesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const data = await service.list(id);
    return reply.send({ success: true, data });
  };

  put = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const data = await service.put(id, request.body as PutTenantModulesInput);
    return reply.send({ success: true, data });
  };
}
