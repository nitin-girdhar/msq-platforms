import type { FastifyRequest } from 'fastify';
import { readAuthContext, checkInternalSecret } from '@platform/service-auth';
import { resolveGlobalRole } from '@platform/db';
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
  // resolveGlobalRole, not resolveGlobalRank: both read the same ladder
  // (iam.user_org_mapping -> iam.user_roles.rank, -1 when there is no active
  // mapping), but this one also returns the role NAME.
  //
  // The name matters because `role` below carries platform_role, which is a
  // 4-value denormalisation of the user's GLOBAL role — it is NOT a key into the
  // capability matrix. A capability check keyed on it resolves a DIFFERENT role's
  // grants than /auth/me and every product service use: someone globally
  // org_admin but mapped into this org under a restricted role would be denied
  // everywhere in LMS and allowed here, while a tenant-defined role collapses to
  // 'member', which matches no row in iam.user_roles and is denied even when
  // granted. See api-clients.controller.ts, the one caller that gates on a
  // capability in this service.
  const { role: role_name, rank } = await resolveGlobalRole(user_id, org_id);
  request.auth = { org_id, user_id, tenant_id, role: platform_role, role_name, rank };
}

// Gateway-secret-only check — used by /auth/change-password, which reads
// x-user-id directly rather than the full request.auth context.
export async function requireInternalSecret(request: FastifyRequest): Promise<void> {
  if (!checkInternalSecret(request.headers, INTERNAL_SECRET)) {
    throw new UnauthorizedError('Unauthorized');
  }
}
