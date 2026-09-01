import { can, holdsUsableNode, CAPABILITY, type CapabilityHolder } from '@platform/rbac';

/**
 * May this actor open the Team screen at all?
 *
 * Gated on the OPERATION (`admin.team.view`), not on a single scope. Asking for
 * `.view.team` specifically — as this did before the screen became shared —
 * locked out a role granted `.view.org` and not `.view.team`, despite that role
 * having strictly WIDER reach. holdsUsableNode() asks the question that matters:
 * the operation is granted, AND some scope beneath it is too. It still fails
 * closed, because a scope never inherits and always needs its own grant row.
 *
 * Which rows they then see is resolveScope()'s answer, resolved server-side in
 * identity-service's listUsers — never trusted from the client.
 *
 * The same predicate backs the nav entry (via filterNav's default rule) and the
 * page guard, so a link can never appear that its own page bounces.
 */
export function canOpenTeam(actor: CapabilityHolder | null | undefined): boolean {
  return holdsUsableNode(actor, CAPABILITY.ADMIN_TEAM_VIEW);
}

/**
 * May this actor create, edit, deactivate or reset anyone?
 *
 * A capability, deliberately — it is the same grant identity-service checks on
 * POST/PATCH /users and that iam.fn_user_can_manage_users resolves inside the
 * RLS write policies, so all three agree. Pair it with canCreateUser() below:
 * this answers "may they manage at all", rank answers "whom".
 */
export function canManageTeam(actor: CapabilityHolder | null | undefined): boolean {
  return can(actor, CAPABILITY.ADMIN_TEAM_MANAGE);
}

/**
 * May an actor of `actorRank` create/assign a user holding `targetRank`?
 *
 * A seniority question, not a capability, and the two are ANDed: capabilities
 * are role-level and tenant-scoped, so they can say "may manage" but never "may
 * manage THIS person". Only rank (or subtree membership) answers that.
 *
 * Mirrors canManageUser in @platform/authz, which identity-service enforces —
 * except that this is the CREATE/assign direction, which is strict: you may not
 * mint a peer at your own rank. Reads must not use it; the roster deliberately
 * shows same-rank reports under the `reports` scope.
 */
export function canCreateUser(actorRank: number, targetRank: number): boolean {
  return actorRank > targetRank;
}

/**
 * May this actor email the affected user on a Team action (account created,
 * password reset, branch changed)?
 *
 * Gates only the visibility of the "Notify user by email" checkbox — advisory,
 * like every frontend check here. identity-service re-derives the same decision
 * (admin.team.notify, or rank >= org_admin) before it calls communication-service,
 * so an unticked box or a forged flag changes nothing server-side.
 */
export function canNotifyUser(actor: CapabilityHolder | null | undefined): boolean {
  return can(actor, CAPABILITY.ADMIN_TEAM_NOTIFY);
}
