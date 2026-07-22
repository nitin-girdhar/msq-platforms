import { can, type CapabilityHolder, type CapabilityKey } from '@platform/rbac';

// A single sidebar/nav entry. Each product app owns its own list of these (LMS
// leads/follow-ups/…, HR leave/attendance, Task tasks) and passes it into the
// shared chrome — the chrome itself carries no product knowledge.
export interface NavItem {
  id: string;
  label: string;
  href: string;
  /**
   * The capability that makes this item visible — normally the page node the link
   * leads to, so the sidebar and the page guard behind it read the same key.
   *
   * Tier C3: this replaced a hard-coded `roles: UserRole[]` list. That list could
   * only name the roles the platform ships with, so a tenant-defined role — which
   * iam.user_roles now allows — matched nothing and rendered an EMPTY sidebar.
   * A capability has no such blind spot: a tenant role holds grants like any
   * other, and showing or hiding an item becomes a DB change, not a deploy.
   */
  capability: CapabilityKey;
}

/**
 * Filter a product's nav down to what the acting user may actually open.
 *
 * An item needs BOTH of:
 *   1. its page node granted, and
 *   2. at least one granted capability BENEATH that node.
 *
 * The second condition matters because nav grants cascade: granting the `lms`
 * tool lights up every page under it, including ones whose operations the role
 * was never given. Without this check a tenant-defined role would see Analytics,
 * click it, and get an empty screen — the render-then-403 bug this whole model
 * exists to remove. A page with nothing usable under it is not a page you can
 * open, so it does not appear.
 *
 * Derived, not another grant: keys nest by construction, so "is anything granted
 * below this node" is a prefix test over the same list.
 *
 * The list comes from /auth/me, resolved from the same DB matrix the services
 * gate on. Still a UX affordance, not the boundary — the gateway, the route-level
 * capability gates and RLS remain the enforcement.
 */
export function filterNav(
  items: readonly NavItem[],
  actor: CapabilityHolder | null | undefined,
): NavItem[] {
  if (!actor) return [];
  const held = actor.capabilities instanceof Set
    ? [...actor.capabilities]
    : (actor.capabilities as readonly string[]);

  return items.filter(
    (item) =>
      can(actor, item.capability) &&
      held.some((k) => k.startsWith(`${item.capability}.`)),
  );
}
