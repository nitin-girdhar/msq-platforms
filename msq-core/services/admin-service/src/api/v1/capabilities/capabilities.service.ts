import { toApiRows } from '@platform/db';
import { ANCHOR_RANK, isPlatformAdminCapability } from '@platform/rbac';
import { ForbiddenError } from '../../../lib/errors.js';
import * as repo from './capabilities.repository.js';
import type { PutGrantsInput } from './capabilities.schema.js';

export async function listCapabilities() {
  return toApiRows(await repo.listCapabilities());
}

export async function listRoleCapabilities(roleId: string, tenantId: string) {
  return toApiRows(await repo.listRoleCapabilities(roleId, tenantId));
}

/**
 * The `admin` subtree is not assignable to a role below super_admin.
 *
 * WHY THIS EXISTS. The Capability Matrix screen renders the whole catalog for
 * whichever role is selected, and its banner tells the operator that pages come
 * on when the tool above them is on — so granting the platform console to a
 * sales role was two ticks. It could never WORK (every route behind that console
 * re-checks rank >= SUPER_ADMIN, and lookup-admin's layout now does too), but it
 * did open the door onto a screen where every call 403s. Refusing the write is
 * what makes the mistake unreachable rather than merely inert.
 *
 * Nor is the grant ever useful: super_admin holds these keys via the `*` wildcard
 * in db_scripts/07, not through per-key rows, so the only assignment this rule can
 * block is a wrong one.
 *
 * Lives in the service, not the controller: it is an invariant of the data, and
 * should hold for any caller rather than for one route. The controller's own
 * `rank < SUPER_ADMIN` check on the ACTOR stays as it is — that says who may edit
 * grants at all; this says what may be written.
 */
async function assertGrantsAssignable(roleId: string, data: PutGrantsInput): Promise<void> {
  // A deny must always get through: is_granted=false is how a bad grant is taken
  // away, and blocking it would make one written before this rule permanent.
  const additions = data.grants.filter((g) => g.is_granted);
  if (additions.length === 0) return;

  const catalog = await repo.listCapabilities();
  const keyById = new Map(catalog.map((row) => [row.id, row.key]));

  // Fail closed, like the rest of the model: an id absent from the catalog is a
  // rejection, not a row we quietly skip.
  const unknown = additions.filter((g) => !keyById.has(g.capability_id));
  if (unknown.length > 0) {
    throw new ForbiddenError(
      `Unknown capability: ${unknown.map((g) => g.capability_id).join(', ')}`,
    );
  }

  const platformAdmin = additions
    .map((g) => keyById.get(g.capability_id))
    .filter((key): key is string => key !== undefined && isPlatformAdminCapability(key));
  if (platformAdmin.length === 0) return;

  const rank = await repo.getRoleRank(roleId);
  if (rank === undefined) throw new ForbiddenError('Unknown role');
  if (rank < ANCHOR_RANK.SUPER_ADMIN) {
    throw new ForbiddenError(
      `Platform administration is not assignable to tenant roles: ${platformAdmin.join(', ')}. ` +
        'The lookup-admin console requires the super_admin rank, which a grant cannot confer.',
    );
  }
}

export async function putGrants(actorUserId: string, roleId: string, data: PutGrantsInput) {
  await assertGrantsAssignable(roleId, data);
  const rows = await repo.upsertGrants({
    actorUserId,
    tenantId: data.tenant_id,
    roleId,
    grants: data.grants.map((g) => ({ capabilityId: g.capability_id, isGranted: g.is_granted })),
  });
  return toApiRows(rows.filter((r): r is NonNullable<typeof r> => r !== undefined));
}
