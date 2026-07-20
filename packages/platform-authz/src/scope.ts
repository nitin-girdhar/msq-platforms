import type { SessionUser } from '@crm/types';

export function resolveActorOrgIds(actor: SessionUser): string[] | null {
  if (actor.role === 'super_admin' || actor.role === 'tenant_admin') return null;
  return [actor.org_id];
}

// Cross-org visibility is a platform_role concern (tenant_admin/super_admin),
// not a product-rank one — no product rank scale can express "sees every org
// in the tenant". `role` is platform_role in services and the session role in
// the web app (the 'tenant_admin'/'super_admin' literals are identical in both).
export function isTenantWideRole(role: string): boolean {
  return role === 'super_admin' || role === 'tenant_admin';
}

// Below tenant scope, the actor's own org is forced server-side — showing an
// org picker there would let someone select other orgs whose names/existence
// they have no business seeing, and the selection would be silently ignored by
// the backend anyway. Only tenant-wide actors cross orgs.
export function canSeeOrgFilter(role: string): boolean {
  return isTenantWideRole(role);
}

// Moving a user to a different branch (org) crosses orgs, so only tenant-wide
// actors may do it — same authority as canSeeOrgFilter.
export function checkMoveUserBranchAccess(role: string): boolean {
  return isTenantWideRole(role);
}
