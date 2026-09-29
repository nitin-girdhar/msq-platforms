import type { ProductKey, SessionUser } from '@platform/types';
import {
  allowedRedirectOrigins,
  productOrigins,
  usableProducts,
  landingFor,
  PRODUCT_LANDING,
} from '@platform/ui-kit';

// Where a user with no usable product goes. Not a redirect loop and not a
// silent 403 wall — an explicit "your account has no products" page.
export const NO_ACCESS_PATH = '/no-access';

/**
 * The allowlist reduced to bare ORIGINS.
 *
 * allowedRedirectOrigins() returns BASE URLs, and under the single-origin
 * topology those carry a path prefix (`https://apps.app.com/lms`). Comparing a
 * callback's `url.origin` against them literally would never match, so each
 * entry is normalized here. A malformed entry is dropped rather than thrown on:
 * one bad env value must not take the login redirect down.
 */
function allowedOrigins(bases: readonly string[]): string[] {
  const origins: string[] = [];
  for (const base of bases) {
    try {
      origins.push(new URL(base).origin);
    } catch {
      // Not an absolute URL — unusable as an allowlist entry, so ignore it.
    }
  }
  return origins;
}

/**
 * Open-redirect guard for the post-login `callbackUrl`. An ABSOLUTE callback is
 * honored only when its origin is one of our own product/auth origins; anything
 * else (an attacker-supplied host) is rejected. A RELATIVE path is accepted only
 * in single-host dev, where auth and the products share one origin (no
 * configured cross-app origins). This is what keeps
 * `?callbackUrl=https://evil.example` from turning login into a redirector.
 *
 * DELIBERATELY COARSE, and correct — do not "fix" this back to a prefix match.
 * Every app now lives behind ONE host under a path prefix (apps.app.com is
 * auth-web; /lms /hrms /todo /admin /sa are the others), so matching on origin
 * accepts ANY path on that host, not just the six configured prefixes. That is
 * the right boundary: under a single origin every internal path IS our own
 * application, one PWA scope and one cookie jar, and a same-origin redirect
 * cannot hand a session to anybody else. The property this guard exists for —
 * refusing to bounce the user to a host we do not control — is untouched, and
 * the foreign-origin test cases pin it. Narrowing this to a path-prefix match
 * would only break legitimate return targets (a deep link into a product route,
 * a prefix added by a later deploy) while adding no security.
 *
 * Returns null when there is no usable target, rather than a hardcoded product
 * default. The old default sent EVERY user to the LMS dashboard, which an
 * HRMS-only tenant is not licensed for — the caller must derive a destination
 * from the session instead (see {@link sessionDestination}).
 */
export function resolveCallback(raw: string | undefined): string | null {
  if (!raw) return null;

  // `bases` (not the normalized list) decides single-host dev: "no cross-app
  // URLs are configured", which a dropped malformed entry must not fake.
  const bases = allowedRedirectOrigins();
  try {
    const url = new URL(raw);
    return allowedOrigins(bases).includes(url.origin) ? url.toString() : null;
  } catch {
    // Not absolute → a path. Trust it only when we're single-host (no split).
    if (raw.startsWith('/') && !raw.startsWith('//') && bases.length === 0) return raw;
    return null;
  }
}

/**
 * Where to send an authenticated user with no explicit callback: the first
 * product they can actually open — tenant license INTERSECT their capabilities —
 * in lms → hr → task order. Absolute in the split topology.
 *
 * Falls back to the no-access page rather than guessing a product, so a
 * misconfigured tenant surfaces as a readable message instead of a 403 wall.
 */
export function sessionDestination(
  licensedProducts: readonly ProductKey[],
  session: SessionUser,
): string {
  const origins = productOrigins();
  const landing = landingFor(usableProducts(licensedProducts, session), origins);
  if (landing) return landing;

  // Single-host dev has no configured origins, so landingFor() can come back
  // null even when a product IS usable. Fall back to its bare path there before
  // concluding there is no access at all.
  const [first] = usableProducts(licensedProducts, session);
  return first ? PRODUCT_LANDING[first] : NO_ACCESS_PATH;
}
