import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { ForbiddenError, BadRequestError } from '../../../lib/errors.js';
import * as service from './capabilities.service.js';
import type { TenantQuery, RoleIdParams, PutGrantsInput } from './capabilities.schema.js';

// Gated the same way every other admin-service route is (rank-only — see
// auth.middleware.ts's comment on why this service does no DB capability
// lookup). The UI additionally gates the Capabilities nav entry on
// admin.roles.manage so it never appears for someone who'd 403 here; folding a
// real capability check into this middleware is a separate, larger change
// that would affect every route in this service, not just this one.
export class CapabilitiesController {
  list = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const data = await service.listCapabilities();
    return reply.send({ success: true, data });
  };

  listForRole = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as RoleIdParams;
    const { tenant_id } = request.query as TenantQuery;
    const data = await service.listRoleCapabilities(id, tenant_id);
    return reply.send({ success: true, data });
  };

  putGrants = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth.rank < RANKS.SUPER_ADMIN) throw new ForbiddenError('Super admin only');
    const { id } = request.params as RoleIdParams;
    const body = request.body as PutGrantsInput;
    try {
      const data = await service.putGrants(request.auth.user_id, id, body);
      return reply.send({ success: true, data });
    } catch (err) {
      // Only the "tenant has no organizations" precondition from the
      // repository surfaces here as a plain Error; anything else rethrows.
      if (err instanceof Error && err.message.includes('no organizations')) {
        throw new BadRequestError(err.message);
      }
      throw err;
    }
  };
}
