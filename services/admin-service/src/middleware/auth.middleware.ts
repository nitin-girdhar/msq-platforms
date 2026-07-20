import type { FastifyRequest } from 'fastify';
import { readAuthContext, checkInternalSecret } from '@crm/service-auth';
import { platformRank } from '@platform/authz';
import type { PlatformRole } from '@crm/types';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

// Full session context — used by all lookup-admin routes.
// admin-service gates purely on platform tiers (its lookups are super_admin-only,
// tenant/org admin for a few), so `rank` is the coarse platform rank derived from
// platform_role — no DB lookup needed. `role` carries platform_role.
export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  const { org_id, user_id, tenant_id, platform_role } = result.auth;
  request.auth = {
    org_id,
    user_id,
    tenant_id,
    role: platform_role,
    rank: platformRank(platform_role as PlatformRole),
  };
}

// Gateway-secret-only check.
export async function requireInternalSecret(request: FastifyRequest): Promise<void> {
  if (!checkInternalSecret(request.headers, INTERNAL_SECRET)) {
    throw new UnauthorizedError('Unauthorized');
  }
}
