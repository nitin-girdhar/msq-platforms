// Authorization rules for managing other users (create / update / delete /
// reset-password). These prevent horizontal and vertical privilege escalation:
// a user must never be able to grant a role above their own rank, nor act on a
// user who already outranks them. RLS enforces org/tenant isolation; these
// rules enforce the rank ceiling that RLS does not.

/**
 * Whether an actor may grant/assign a role of `targetRoleRank`.
 * An actor can grant roles at or below their own rank, never above it —
 * so a Senior Sales Executive can never mint an Org Admin or Super Admin.
 */
export function canGrantRole(actorRank: number, targetRoleRank: number): boolean {
  return actorRank >= targetRoleRank;
}

/**
 * Whether an actor may manage (update/delete/reset) a user whose current rank
 * is `targetCurrentRank`. An actor can manage peers and subordinates, never a
 * user who outranks them.
 */
export function canManageUser(actorRank: number, targetCurrentRank: number): boolean {
  return actorRank >= targetCurrentRank;
}
