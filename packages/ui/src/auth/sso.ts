import type { ProductKey } from '@crm/types';

// Cross-app SSO origins. In the split topology each product UI is a separate
// origin (lms.app.com / hr.app.com / todo.app.com) and login lives at
// auth.app.com. These helpers centralize how an app finds the auth origin (for
// unauthenticated redirects) and the sibling product origins (for the product
// switcher). Read server-side / in middleware only; Server Components pass the
// resolved values down to client chrome as props, so we never depend on Next's
// client-side NEXT_PUBLIC inlining.

// The auth origin (scheme + host, no trailing slash), e.g. https://auth.app.com.
// Empty in single-host local dev → callers fall back to a same-origin /login.
export function authOrigin(): string {
  return (process.env['NEXT_PUBLIC_AUTH_URL'] ?? '').replace(/\/$/, '');
}

// Absolute or same-origin login URL carrying the post-login return target.
// `callbackUrl` should be an absolute product URL in the split topology so auth
// can send the user straight back to the product they came from.
export function buildLoginUrl(callbackUrl?: string): string {
  const base = `${authOrigin()}/login`;
  return callbackUrl ? `${base}?callbackUrl=${encodeURIComponent(callbackUrl)}` : base;
}

// Per-product origin map (empty string when unset). Drives the product switcher
// links and the auth callback allowlist.
export function productOrigins(): Record<ProductKey, string> {
  return {
    lms: (process.env['NEXT_PUBLIC_LMS_URL'] ?? '').replace(/\/$/, ''),
    hr: (process.env['NEXT_PUBLIC_HR_URL'] ?? '').replace(/\/$/, ''),
    task: (process.env['NEXT_PUBLIC_TASK_URL'] ?? '').replace(/\/$/, ''),
  };
}

// The set of origins the auth app is allowed to redirect back to after login —
// the product origins plus the auth origin itself. An absolute callbackUrl is
// honored only if its origin is in this set (open-redirect guard); anything
// else falls back to a safe default.
export function allowedRedirectOrigins(): string[] {
  return [authOrigin(), ...Object.values(productOrigins())].filter((o) => o.length > 0);
}
