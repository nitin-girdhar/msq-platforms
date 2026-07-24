import type { FastifyRequest, FastifyReply } from 'fastify';
import { RANKS } from '@platform/authz';
import { CAPABILITY, type CapabilityKey } from '@platform/rbac';
import { hasCapabilityFresh } from '@platform/db';
import type { CreateApiClientInput, UpdateApiClientInput } from '@platform/validation';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './api-clients.service.js';

// org_admin (branch admin) and above manage API credentials; org_admin is
// restricted server-side to their own branch (see resolveBranchScope in the
// service layer) — never trust a client-supplied org_ids/scope_all_orgs for them.
function requireApiClientAdmin(rank: number): void {
  if (rank < RANKS.ADMIN) {
    throw new ForbiddenError('Only branch admins and above can manage API clients');
  }
}

// The rank gate above is the floor; the `lms.apiclients` capability is the tenant's
// per-role switch for this feature. Enforce it here so revoking the capability
// actually blocks the API — not just the nav (see openissues.md Issue #2). Denying
// the `lms.apiclients` page node cascades to deny both view/manage in the matrix,
// so checking the operation-level key is sufficient and precise.
//
// These endpoints mint/rotate/delete integration credentials, so we resolve the
// capability FRESH (hasCapabilityFresh) rather than through the ≤5-minute TTL
// capability cache: a tenant that revokes `lms.apiclients` must lose API-token
// management immediately, not after the cache backstop expires (Issue #2). The
// per-call DB round trip is acceptable on this low-traffic, high-sensitivity path.
async function requireApiClientCapability(
  auth: { tenant_id: string; role: string; rank: number },
  capability: CapabilityKey,
): Promise<void> {
  requireApiClientAdmin(auth.rank);
  const granted = await hasCapabilityFresh(auth.tenant_id, auth.role, capability);
  if (!granted) {
    throw new ForbiddenError('API client management is not enabled for your role');
  }
}

export class ApiClientsController {
  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    await requireApiClientCapability({ tenant_id, role, rank }, CAPABILITY.LMS_APICLIENTS_MANAGE);
    const data = request.body as CreateApiClientInput;
    const isOrgAdmin = rank < RANKS.TENANT_ADMIN;
    const result = await service.createApiClient({ org_id, user_id, role, tenant_id }, data, isOrgAdmin);
    return reply.status(201).header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    await requireApiClientCapability({ tenant_id, role, rank }, CAPABILITY.LMS_APICLIENTS_VIEW);
    const clients = await service.listApiClients({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: clients });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    await requireApiClientCapability({ tenant_id, role, rank }, CAPABILITY.LMS_APICLIENTS_MANAGE);
    const { id } = request.params as { id: string };
    const data = request.body as UpdateApiClientInput;
    const isOrgAdmin = rank < RANKS.TENANT_ADMIN;
    const result = await service.updateApiClient({ org_id, user_id, role, tenant_id }, id, data, isOrgAdmin);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  rotate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    await requireApiClientCapability({ tenant_id, role, rank }, CAPABILITY.LMS_APICLIENTS_MANAGE);
    const { id } = request.params as { id: string };
    const result = await service.rotateApiClient({ org_id, user_id, role, tenant_id }, id);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  revoke = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, tenant_id, rank } = request.auth;
    await requireApiClientCapability({ tenant_id, role, rank }, CAPABILITY.LMS_APICLIENTS_MANAGE);
    const { id } = request.params as { id: string };
    await service.revokeApiClient({ org_id, user_id, role, tenant_id }, id);
    return reply.status(204).send();
  };
}
