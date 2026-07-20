import { allowedRedirectOrigins, productOrigins } from '@platform/ui-kit';

// Where to send a freshly-authenticated user with no explicit callback: the
// lead product's dashboard (LMS is the default landing product). Absolute in
// the split topology; a bare path in single-host dev.
export function defaultDestination(): string {
  const lms = productOrigins().lms;
  return lms ? `${lms}/dashboard/leads` : '/dashboard/leads';
}

// Open-redirect guard for the post-login `callbackUrl`. An ABSOLUTE callback is
// honored only when its origin is one of our own product/auth origins; anything
// else (an attacker-supplied host) falls back to the safe default. A RELATIVE
// path is accepted only in single-host dev, where auth and the products share
// one origin (no configured cross-app origins). This is what keeps
// `?callbackUrl=https://evil.example` from turning login into a redirector.
export function resolveCallback(raw: string | undefined): string {
  const fallback = defaultDestination();
  if (!raw) return fallback;

  const origins = allowedRedirectOrigins();
  try {
    const url = new URL(raw);
    return origins.includes(url.origin) ? url.toString() : fallback;
  } catch {
    // Not absolute → a path. Trust it only when we're single-host (no split).
    if (raw.startsWith('/') && !raw.startsWith('//') && origins.length === 0) return raw;
    return fallback;
  }
}
