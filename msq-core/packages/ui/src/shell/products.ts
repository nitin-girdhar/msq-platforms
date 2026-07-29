import type { ProductKey } from '@platform/types';
import type { CapabilityHolder, CapabilityKey } from '@platform/rbac';
import { holdsUsableNode } from './nav';

// ── Which products this USER can actually open ──────────────────────────────
//
// `licensed_products` (the JWT claim) is a TENANT fact, read from
// entity.tenant_modules. It answers "did this tenant buy CRM?", never "may THIS
// person open it". A tenant on LMS+HR whose HR staff hold no lms.* capability
// would still get a CRM tab, land on a rendered shell with an empty sidebar and
// 403-ing data calls — the render-then-403 bug the capability model exists to
// remove (see nav.ts).
//
// So every product entry point — the switcher, the post-login landing, the
// denial redirects — resolves through usableProducts(): tenant license INTERSECT
// user capability. Pure and env-free, so Server Components and the client-side
// LoginForm share one answer.
//
// Still an affordance, not the boundary: the gateway's entitlement gate
// (require-product.ts) and the per-service capability gates remain the
// enforcement.

// A product is reachable through any of its tool nodes. HR spans three because
// the tenant_modules grain is finer than the product grain — the same reason
// modulesToProducts() maps leave OR attendance to 'hr'.
const PRODUCT_CAPABILITY_ROOTS: Record<ProductKey, readonly CapabilityKey[]> = {
  lms: ['lms'],
  hr: ['hr.attendance', 'hr.leave', 'hr.employees'],
  task: ['tasks'],
};

// Landing path within each product origin. Stable product entry points.
export const PRODUCT_LANDING: Record<ProductKey, string> = {
  lms: '/dashboard/leads',
  hr: '/attendance',
  task: '/tasks',
};

// Priority for "send them somewhere sensible with no explicit target". LMS stays
// first so the existing default is unchanged for tenants that have it.
const PRODUCT_PRIORITY: readonly ProductKey[] = ['lms', 'hr', 'task'];

/**
 * The products `actor` can actually open, out of the tenant's licensed set.
 *
 * Fails CLOSED at every step: an unlicensed product, a null actor, or a role
 * holding a tool node with nothing usable beneath it all drop out.
 */
export function usableProducts(
  licensed: readonly ProductKey[] | null | undefined,
  actor: CapabilityHolder | null | undefined,
): ProductKey[] {
  // `licensed` is nullable because it crosses a service boundary (the login
  // response). A rolling deploy that pairs a new UI with an older identity build
  // must degrade to "no products", not throw.
  if (!actor || !licensed) return [];
  return licensed.filter((product) =>
    PRODUCT_CAPABILITY_ROOTS[product].some((root) => holdsUsableNode(actor, root)),
  );
}

/**
 * Absolute landing URL for the first usable product with a configured origin, or
 * null when there is none — which the caller should treat as "no access", not as
 * a reason to fall back to a hardcoded product.
 *
 * A product with no configured origin is skipped rather than linked to a broken
 * host; in single-host dev (every origin empty) this returns null and callers
 * fall back to a bare path.
 */
export function landingFor(
  products: readonly ProductKey[],
  origins: Record<ProductKey, string>,
): string | null {
  const target = PRODUCT_PRIORITY.find((p) => products.includes(p) && origins[p]);
  return target ? `${origins[target]}${PRODUCT_LANDING[target]}` : null;
}
