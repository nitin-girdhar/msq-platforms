import type { FastifyRequest, FastifyReply } from 'fastify';
import { CAPABILITY, type CapabilityKey } from '@platform/rbac';
import { hasCapabilityFresh } from '@platform/db';
import type { CreateApiClientInput, UpdateApiClientInput } from '@platform/validation';
import { ForbiddenError } from '../../../lib/errors.js';
import * as service from './api-clients.service.js';

// API credentials are managed by whoever holds admin.api_tokens.* — a capability,
// not a rank floor (1.76.0; the migration denied the capability to every role
// that the old rank-980 floor used to exclude, so nobody gained access).
//
// A holder WITHOUT admin.api_tokens.tenant_wide is held to their own branch
// server-side (see resolveBranchScope in the service layer) — never trust a
// client-supplied org_ids/scope_all_orgs for them. Revoking the capability must
// actually block the API, not just the nav (see openissues.md Issue #2).
//
// These endpoints mint/rotate/delete integration credentials, so we resolve the
// capability FRESH (hasCapabilityFresh) rather than through the ≤5-minute TTL
// capability cache: a tenant that revokes `platform.api_tokens` must lose API-token
// management immediately, not after the cache backstop expires (Issue #2). The
// per-call DB round trip is acceptable on this low-traffic, high-sensitivity path.
//
// Resolved against `role_name` — the user's iam.user_roles role IN THIS ORG —
// NOT `role`, which carries platform_role. That distinction was a live bug:
// platform_role is a 4-value denormalisation of the user's GLOBAL role, so this
// gate was reading a different role's grants than /auth/me, the LMS nav and every
// leads-service route. Someone globally org_admin but mapped into this org under
// a restricted role was denied everywhere in LMS and allowed here — on the one
// endpoint family that mints integration credentials — while any tenant-defined
// role collapsed to 'member', which matches no row and was denied even when the
// capability was granted. hasCapabilityFresh still fails closed on a null name.
async function requireApiClientCapability(
  auth: { tenant_id: string; role_name: string | null },
  capability: CapabilityKey,
): Promise<void> {
  const granted = await hasCapabilityFresh(auth.tenant_id, auth.role_name, capability);
  if (!granted) {
    throw new ForbiddenError('API client management is not enabled for your role');
  }
}

// Branch-only unless the role also holds the tenant-wide key. Fresh, like the gate.
async function isBranchScoped(auth: { tenant_id: string; role_name: string | null }): Promise<boolean> {
  return !(await hasCapabilityFresh(auth.tenant_id, auth.role_name, CAPABILITY.ADMIN_API_TOKENS_TENANT_WIDE));
}

export class ApiClientsController {
  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id } = request.auth;
    await requireApiClientCapability({ tenant_id, role_name }, CAPABILITY.ADMIN_API_TOKENS_MANAGE);
    const data = request.body as CreateApiClientInput;
    const isOrgAdmin = await isBranchScoped({ tenant_id, role_name });
    const result = await service.createApiClient({ org_id, user_id, role, tenant_id }, data, isOrgAdmin);
    return reply.status(201).header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  list = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id } = request.auth;
    await requireApiClientCapability({ tenant_id, role_name }, CAPABILITY.ADMIN_API_TOKENS_VIEW);
    const clients = await service.listApiClients({ org_id, user_id, role, tenant_id });
    return reply.send({ success: true, data: clients });
  };

  update = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id } = request.auth;
    await requireApiClientCapability({ tenant_id, role_name }, CAPABILITY.ADMIN_API_TOKENS_MANAGE);
    const { id } = request.params as { id: string };
    const data = request.body as UpdateApiClientInput;
    const isOrgAdmin = await isBranchScoped({ tenant_id, role_name });
    const result = await service.updateApiClient({ org_id, user_id, role, tenant_id }, id, data, isOrgAdmin);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  rotate = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id } = request.auth;
    await requireApiClientCapability({ tenant_id, role_name }, CAPABILITY.ADMIN_API_TOKENS_MANAGE);
    const { id } = request.params as { id: string };
    const result = await service.rotateApiClient({ org_id, user_id, role, tenant_id }, id);
    return reply.header('Cache-Control', 'no-store').send({ success: true, data: result });
  };

  revoke = async (request: FastifyRequest, reply: FastifyReply) => {
    const { org_id, user_id, role, role_name, tenant_id } = request.auth;
    await requireApiClientCapability({ tenant_id, role_name }, CAPABILITY.ADMIN_API_TOKENS_MANAGE);
    const { id } = request.params as { id: string };
    await service.revokeApiClient({ org_id, user_id, role, tenant_id }, id);
    return reply.status(204).send();
  };
}
