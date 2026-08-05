import type { ProductKey } from '@platform/types';

// Cross-app SSO origins. In the split topology each product UI is a separate
// origin (lms.app.com / hr.app.com / todo.app.com) and login lives at
// auth.app.com. These helpers centralize how an app finds the auth origin (for
// unauthenticated redirects) and the sibling product origins (for the product
// switcher). Read server-side / in middleware only; Server Components pass the
// resolved values down to client chrome as props, so we never depend on Next's
// client-side NEXT_PUBLIC inlining.
//
// The UNPREFIXED names are what make these configurable per deployment. Next
// substitutes `NEXT_PUBLIC_*` reads with string literals at build time in BOTH
// the client and the server/middleware bundles, which froze the auth origin
// into the image: a deployment could not be repointed without a rebuild, and
// shipping images built with the dev defaults sent users to localhost. A plain
// name is never substituted, so it is a real runtime lookup and `.env` on the
// server is authoritative.
//
// The NEXT_PUBLIC_* fallbacks keep older .env files working. They resolve to
// build-time literals, so treat them as a legacy default only — always set the
// unprefixed name in a real deployment.
function originFromEnv(name: string): string {
  const value = process.env[name] ?? process.env[`NEXT_PUBLIC_${name}`] ?? '';
  return value.replace(/\/$/, '');
}

// The auth origin (scheme + host, no trailing slash), e.g. https://auth.app.com.
// Empty in single-host local dev → callers fall back to a same-origin /login.
export function authOrigin(): string {
  return originFromEnv('AUTH_URL');
}

// Absolute or same-origin login URL carrying the post-login return target.
// `callbackUrl` should be an absolute product URL in the split topology so auth
// can send the user straight back to the product they came from.
export function buildLoginUrl(callbackUrl?: string): string {
  const base = `${authOrigin()}/login`;
  return callbackUrl ? `${base}?callbackUrl=${encodeURIComponent(callbackUrl)}` : base;
}

// The lookup-admin origin (platform staff tooling), e.g. https://admin.app.com.
//
// Deliberately NOT part of productOrigins(): lookup-admin is not a licensed
// product, must never appear in the product switcher, and must never be chosen
// as a post-login landing destination by sessionDestination(). It only needs to
// be a permitted RETURN target, so it is added to allowedRedirectOrigins() alone.
export function adminOrigin(): string {
  return originFromEnv('ADMIN_URL');
}

// The admin-web origin (org_admin/tenant_admin console: Team, API Tokens,
// Leave/Attendance admin), e.g. https://admin-web.app.com. Distinct from
// adminOrigin() (lookup-admin, super_admin-only platform tooling) — same
// reasoning applies: not a licensed product, never in the product switcher,
// never a sessionDestination() landing target, only a permitted RETURN target.
export function adminWebOrigin(): string {
  return originFromEnv('ADMIN_WEB_URL');
}

// Per-product origin map (empty string when unset). Drives the product switcher
// links and the auth callback allowlist.
export function productOrigins(): Record<ProductKey, string> {
  return {
    lms: originFromEnv('LMS_URL'),
    hr: originFromEnv('HR_URL'),
    task: originFromEnv('TASK_URL'),
  };
}

// The set of origins the auth app is allowed to redirect back to after login —
// the product origins plus the auth origin itself. An absolute callbackUrl is
// honored only if its origin is in this set (open-redirect guard); anything
// else falls back to a safe default.
export function allowedRedirectOrigins(): string[] {
  return [
    authOrigin(),
    adminOrigin(),
    adminWebOrigin(),
    ...Object.values(productOrigins()),
  ].filter((o) => o.length > 0);
}
