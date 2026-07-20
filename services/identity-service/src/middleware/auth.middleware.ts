import type { FastifyRequest } from 'fastify';
import { readAuthContext, checkInternalSecret } from '@platform/service-auth';
import { resolveGlobalRank } from '@platform/db';
import { UnauthorizedError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

// Full session context — used by /users/* and /orgs/* routes.
// P1.3: the JWT no longer carries a rank. User management runs on the GLOBAL
// iam.user_roles ladder (rank ceilings via canGrantRole/canManageUser, kept
// authoritative by P1.1/P1.2), so resolve the acting user's global rank from
// iam server-side. `role` carries the platform_role (drives withRoleTx PG-role
// selection + the ctx.role === 'super_admin' org-scope checks in the repo).
export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  const { org_id, user_id, tenant_id, platform_role } = result.auth;
  const rank = await resolveGlobalRank(user_id, org_id);
  request.auth = { org_id, user_id, tenant_id, role: platform_role, rank };
}

// Gateway-secret-only check — used by /auth/change-password, which reads
// x-user-id directly rather than the full request.auth context.
export async function requireInternalSecret(request: FastifyRequest): Promise<void> {
  if (!checkInternalSecret(request.headers, INTERNAL_SECRET)) {
    throw new UnauthorizedError('Unauthorized');
  }
}
