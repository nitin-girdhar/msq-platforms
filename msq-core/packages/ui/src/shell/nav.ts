import { can, holdsUsableNode, type CapabilityHolder, type CapabilityKey } from '@platform/rbac';
import type { NavIconName } from './NavIcon';
import { applyNavOverride, type NavOverride } from '../branding/types';

// holdsUsableNode moved down into @platform/rbac so the product PAGE GUARDS can
// ask the same question the sidebar asks without depending on a React package —
// see its doc comment there. Re-exported unchanged so ./products, this package's
// shell barrel and the existing tests keep importing it from here.
export { holdsUsableNode };

// A single sidebar/nav entry. Each product app owns its own list of these (LMS
// leads/follow-ups/…, HR leave/attendance, Task tasks) and passes it into the
// shared chrome — the chrome itself carries no product knowledge.
export interface NavItem {
  id: string;
  label: string;
  href: string;
  /**
   * Symbol drawn beside the label, and alone in the collapsed rail. Optional:
   * an entry without one falls back to its initials ("Leads History" → "LH"),
   * so a new menu never renders blank. Purely visual — visibility is still
   * decided by `capability` below.
   */
  icon?: NavIconName;
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
 * Is `item` the current page's nav entry?
 *
 * A plain prefix test lights up BOTH "My Tasks" (/tasks) and "Team Tasks"
 * (/tasks/team) on /tasks/team. When two entries match, the one with the longer
 * href is the more specific page and wins; the shorter one stays dark. Entries
 * that do not overlap behave exactly as the prefix test did.
 */
export function isNavItemActive(
  item: Pick<NavItem, 'href'>,
  pathname: string,
  all: readonly Pick<NavItem, 'href'>[],
): boolean {
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (!matches(item.href)) return false;
  return !all.some((other) => other.href.length > item.href.length && matches(other.href));
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

/**
 * Apply the tenant's menu overrides (label / icon from the fixed NavIcon set)
 * keyed by nav item id. Visual only: ids, hrefs and capabilities are untouched,
 * so filtering and page guards behave exactly as without branding.
 */
export function brandNav<T extends readonly NavItem[] | readonly NavGroup[]>(
  items: T,
  overrides: Record<string, NavOverride>,
): T {
  if (Object.keys(overrides).length === 0) return items;
  if (isNavGroups(items)) {
    return items.map((g) => ({ ...g, items: g.items.map((i) => applyNavOverride(i, overrides)) })) as unknown as T;
  }
  return (items as readonly NavItem[]).map((i) => applyNavOverride(i, overrides)) as unknown as T;
}
