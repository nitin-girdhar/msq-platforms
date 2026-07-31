import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { BadRequestError, ForbiddenError } from '../../../lib/errors.js';
import * as service from './user-roles.service.js';
import type { CreateUserRoleInput, UpdateUserRoleInput } from './user-roles.schema.js';

// Roles are tenant-owned (only super_admin is global — see
// _migrations/23_tenant_scope_admin_roles.sql), so every route here needs the
// tenant the admin has selected. Required rather than defaulted: without it the
// list silently returned every tenant's roles flattened together, which read as
// duplicates on the console.
function requireTenantId(request: FastifyRequest): string {
  const { tenant_id: tenantId } = request.query as { tenant_id?: string };
  if (!tenantId) throw new BadRequestError('tenant_id is required.');
  return tenantId;
}

export class UserRolesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.list(requireTenantId(request));
    return reply.send({ success: true, data });
  };

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const tenantId = requireTenantId(request);
    const body = request.body as CreateUserRoleInput;
    const data = await service.create(tenantId, body);
    return reply.status(201).send({ success: true, data });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as { id: string };
    const body = request.body as UpdateUserRoleInput;
    const data = await service.update(id, body);
    return reply.send({ success: true, data });
  };
}
