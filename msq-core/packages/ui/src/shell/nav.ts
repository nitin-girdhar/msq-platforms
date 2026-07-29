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
  /**
   * Gate on `capability` EXACTLY (plain `can()`) instead of the nav-node rule in
   * {@link holdsUsableNode}.
   *
   * Set this when the entry is guarded by an OPERATION rather than a tool/page
   * node — e.g. `admin.roles.manage`, which the seed hangs directly off the
   * `admin` tool with nothing beneath it. holdsUsableNode() demands a granted
   * descendant, so an operation key can never satisfy it and the item would be
   * invisible to EVERY user, super admin included.
   */
  exact?: boolean;
}

/**
 * Is `key` a nav node the actor can actually OPEN — as opposed to merely holding?
 *
 * Needs BOTH of:
 *   1. the node itself granted, and
 *   2. at least one granted capability BENEATH it.
 *
 * The second condition matters because nav grants cascade: granting the `lms`
 * tool lights up every page under it, including ones whose operations the role
 * was never given. Without this check a tenant-defined role would see Analytics,
 * click it, and get an empty screen — the render-then-403 bug this whole model
 * exists to remove. A node with nothing usable under it is not one you can open.
 *
 * Derived, not another grant: keys nest by construction, so "is anything granted
 * below this node" is a prefix test over the same list.
 *
 * Shared with products.ts, which applies the identical rule one level up — to
 * the product TOOL nodes behind the CRM/HR/Tasks switcher.
 */
export function holdsUsableNode(
  actor: CapabilityHolder | null | undefined,
  key: CapabilityKey,
): boolean {
  if (!actor) return false;
  const held = actor.capabilities instanceof Set
    ? [...actor.capabilities]
    : (actor.capabilities as readonly string[]);

  return can(actor, key) && held.some((k) => k.startsWith(`${key}.`));
}

/**
 * Filter a product's nav down to what the acting user may actually open.
 *
 * An item appears when its page node is openable per {@link holdsUsableNode} —
 * granted, with something granted beneath it — or, for an item marked `exact`,
 * when the actor simply holds the operation it names.
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
  return items.filter((item) =>
    item.exact ? can(actor, item.capability) : holdsUsableNode(actor, item.capability),
  );
}

/**
 * A labeled block of nav items — e.g. one entry per module (LMS/HR/Tasks/…) in
 * an admin tool's left rail. Optional on top of {@link NavItem}: apps with a
 * flat sidebar keep passing `NavItem[]` to {@link AppSidebar}/{@link MobileSidebar}
 * unchanged; apps that need sections pass `NavGroup[]` instead.
 */
export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

/**
 * Same rule as {@link filterNav}, applied per group, with empty groups dropped
 * afterward — a group heading with nothing under it is not worth rendering.
 */
export function filterNavGroups(
  groups: readonly NavGroup[],
  actor: CapabilityHolder | null | undefined,
): NavGroup[] {
  if (!actor) return [];
  return groups
    .map((group) => ({ ...group, items: filterNav(group.items, actor) }))
    .filter((group) => group.items.length > 0);
}

export function isNavGroups(items: readonly NavItem[] | readonly NavGroup[]): items is readonly NavGroup[] {
  const first = items[0];
  return first !== undefined && 'items' in first;
}
