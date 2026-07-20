import type { FastifyRequest } from 'fastify';
import { readAuthContext } from '@platform/service-auth';
import { resolveMemberRole } from '@platform/db';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

const INTERNAL_SECRET = process.env['INTERNAL_SERVICE_SECRET'];

export async function authenticate(request: FastifyRequest): Promise<void> {
  const result = readAuthContext(request.headers, INTERNAL_SECRET);
  if (!result.ok) throw new UnauthorizedError(result.error);
  const { org_id, user_id, tenant_id, platform_role } = result.auth;

  // P1.3: resolve the acting user's Task role/rank from task.member_roles server-side
  // (never a header). task_member is the baseline product grant every member of a
  // tasks-licensed org holds, so a missing grant (rank < 0) means "not provisioned
  // for Tasks in this org" → 403. `role` carries platform_role for withRoleTx.
  const { rank } = await resolveMemberRole('task', user_id, org_id);
  if (rank < 0) {
    throw new ForbiddenError('You do not have access to the Tasks product in this organization');
  }
  request.auth = { org_id, user_id, tenant_id, role: platform_role, rank };
}
