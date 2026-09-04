import type { ProductKey } from '@platform/types';

// Cross-app SSO base URLs. Each product UI is a separate Next app; login lives
// in auth-web. These helpers centralize how an app finds the auth base URL (for
// unauthenticated redirects) and the sibling product base URLs (for the product
// switcher). Read server-side / in middleware only; Server Components pass the
// resolved values down to client chrome as props, so we never depend on Next's
// client-side NEXT_PUBLIC inlining.
//
// A value here is a BASE URL, not necessarily a bare origin. The apps now sit
// behind ONE host with a path prefix per product —
// https://apps.app.com (auth) · /lms · /hrms · /todo · /admin · /sa — so
// `LMS_URL` is `https://apps.app.com/lms`, matching each app's Next `basePath`.
// The single-origin topology is what lets the platform install as one PWA
// holding one push subscription (see docs/Architecture.md → Web push & PWA).
// A one-origin-per-product deployment still works: the prefix is simply empty.
//
// Consequence for every caller: build URLs by CONCATENATION (`${base}/login`),
// never `new URL('/login', base)` — a root-relative resolution discards the
// path prefix and would send the user to the auth app's `/login` on whatever
// host the product happens to be on.
//
// The UNPREFIXED names are what make these configurable per deployment. Next
// substitutes `NEXT_PUBLIC_*` reads with string literals at build time in BOTH
// the client and the server/middleware bundles, which froze the auth base URL
// into the image: a deployment could not be repointed without a rebuild, and
// shipping images built with the dev defaults sent users to localhost. A plain
// name is never substituted, so it is a real runtime lookup and `.env` on the
// server is authoritative.
//
// The NEXT_PUBLIC_* fallbacks keep older .env files working. They resolve to
// build-time literals, so treat them as a legacy default only — always set the
// unprefixed name in a real deployment.
function baseUrlFromEnv(name: string): string {
  const value = process.env[name] ?? process.env[`NEXT_PUBLIC_${name}`] ?? '';
  return value.replace(/\/$/, '');
}

// The auth base URL (no trailing slash), e.g. https://apps.app.com.
// Empty in single-host local dev → callers fall back to a same-origin /login.
export function authOrigin(): string {
  return baseUrlFromEnv('AUTH_URL');
}

// Absolute or same-origin login URL carrying the post-login return target.
// `callbackUrl` should be an absolute product URL in the split topology so auth
// can send the user straight back to the product they came from.
//
// Concatenated, not `new URL('/login', base)`: see the path-prefix note above.
// With an empty base this degrades to the relative `/login?...`, which is the
// single-host dev behavior callers already rely on.
export function buildLoginUrl(callbackUrl?: string): string {
  const base = `${authOrigin()}/login`;
  return callbackUrl ? `${base}?callbackUrl=${encodeURIComponent(callbackUrl)}` : base;
}

// Base self-service change-password URL, without a callback target. Callers
// that know the page the user should return to (e.g. UserMenu, which appends
// the current page client-side) build on top of this; the same page also
// serves the forced-change redirect from createProductMiddleware.
//
// Concatenated for the same reason as buildLoginUrl().
export function buildChangePasswordUrl(): string {
  return `${authOrigin()}/change-password`;
}

// The lookup-admin base URL (platform staff tooling), e.g.
// https://apps.app.com/sa.
//
// Deliberately NOT part of productOrigins(): lookup-admin is not a licensed
// product, must never appear in the product switcher, and must never be chosen
// as a post-login landing destination by sessionDestination(). It only needs to
// be a permitted RETURN target, so it is added to allowedRedirectOrigins() alone.
export function adminOrigin(): string {
  return baseUrlFromEnv('ADMIN_URL');
}

// The admin-web base URL (org_admin/tenant_admin console: Team, API Tokens,
// Leave/Attendance admin), e.g. https://apps.app.com/admin. Distinct from
// adminOrigin() (lookup-admin, super_admin-only platform tooling) — same
// reasoning applies: not a licensed product, never in the product switcher,
// never a sessionDestination() landing target, only a permitted RETURN target.
export function adminWebOrigin(): string {
  return baseUrlFromEnv('ADMIN_WEB_URL');
}

// Per-product base URL map (empty string when unset). Drives the product
// switcher links and the auth callback allowlist.
export function productOrigins(): Record<ProductKey, string> {
  return {
    lms: baseUrlFromEnv('LMS_URL'),
    hr: baseUrlFromEnv('HR_URL'),
    task: baseUrlFromEnv('TASK_URL'),
  };
}

// The set of base URLs the auth app is allowed to redirect back to after login —
// the product base URLs plus the auth app's own. An absolute callbackUrl is
// honored only if it matches this set (open-redirect guard); anything else falls
// back to a safe default. Entries may carry a path prefix, so the comparison is
// made on the ORIGIN of each entry — see resolveCallback in
// apps/auth-web/src/lib/callback.ts for why that is the right boundary.
export function allowedRedirectOrigins(): string[] {
  return [
    authOrigin(),
    adminOrigin(),
    adminWebOrigin(),
    ...Object.values(productOrigins()),
  ].filter((o) => o.length > 0);
}
