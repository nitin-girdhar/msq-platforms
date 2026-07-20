import type { ProductKey } from '@platform/authz';

// ── Route-prefix → product map (D6 central entitlement choke point) ──────────
// Maps a *registered route pattern* (request.routeOptions.url, e.g. '/leads/:id')
// to the product a tenant must have licensed to call it. Matched against the
// route pattern, not the raw URL, so ids/query strings never affect the decision.
//
// Order matters: more specific prefixes (the /hr exclusions) are checked before
// the broader '/hr/' rule. A route with no entry is ungated (users, orgs,
// api-clients, lookups, meta, communications, auth, notifications — platform/
// shared surface). See docs/Architecture.md for the product↔module mapping.

// Prefixes under /hr that stay ungated exactly as before this change:
//  - /hr/employees* : employee profiles were never module-gated
//  - /hr/modules    : entitlement discovery — you need it to know what to gate
const HR_UNGATED_PREFIXES = ['/hr/employees', '/hr/modules'] as const;

// Ordered longest-prefix-first within each product where it matters.
const PRODUCT_PREFIXES: ReadonlyArray<readonly [string, ProductKey]> = [
  // task
  ['/task-lists', 'task'],
  ['/tasks', 'task'],
  // hr (everything else under /hr/* — leave/attendance/holidays/shifts/…)
  ['/hr/', 'hr'],
  // lms
  ['/leads', 'lms'],
  ['/assignments', 'lms'],
  ['/campaigns', 'lms'],
  ['/follow-ups', 'lms'],
  ['/analytics', 'lms'],
  ['/activities', 'lms'],
  ['/locations', 'lms'],
  ['/dashboard', 'lms'],
  ['/org/performance', 'lms'],
];

/**
 * The product required to call `routeUrl`, or `null` if the route is ungated.
 * `routeUrl` should be the registered pattern (`request.routeOptions.url`).
 */
export function productForRoute(routeUrl: string): ProductKey | null {
  if (HR_UNGATED_PREFIXES.some((p) => routeUrl === p || routeUrl.startsWith(`${p}/`))) {
    return null;
  }
  for (const [prefix, product] of PRODUCT_PREFIXES) {
    if (routeUrl === prefix || routeUrl.startsWith(prefix)) return product;
  }
  return null;
}
