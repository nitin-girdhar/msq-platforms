import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { JwtPayload, SessionUser } from '@platform/types';
import { AUTH_COOKIE_NAME } from '@platform/auth-constants';
import { verifySessionJwt } from '../auth/verify-edge';
import { buildLoginUrl, authOrigin } from '../auth/sso';

// API_GATEWAY_INTERNAL_URL is a server-only env var (no NEXT_PUBLIC_ prefix).
// It is never sent to the browser.
const API_GATEWAY = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

async function getJwtPayload(): Promise<JwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  // RS256 (public key) or legacy HS256, selected by the token's alg.
  return verifySessionJwt(token);
}

// Reconstruct the absolute URL of the current request from proxy headers so the
// post-login callback returns the user to THIS product origin (not the auth
// origin). Falls back to the given path when headers are unavailable.
async function absoluteUrl(pathname: string): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return pathname;
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}${pathname}`;
  } catch {
    return pathname;
  }
}

// Build the login redirect target: the shared auth origin when configured
// (split topology), else a same-origin /login (single-host dev).
async function loginRedirect(callbackPath: string): Promise<string> {
  const callback = authOrigin() ? await absoluteUrl(callbackPath) : callbackPath;
  return buildLoginUrl(callback);
}

async function getFullSession(cookieHeader: string): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${API_GATEWAY}/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data: { user: SessionUser } };
    return data.data.user;
  } catch {
    return null;
  }
}

export interface AuthenticatedSession {
  session: SessionUser;
  cookieHeader: string;
  /** Products the acting tenant has licensed, straight off the verified JWT —
   *  drives the product switcher. UX convenience only; the gateway's
   *  entitlement gate remains the authoritative DB-backed check. */
  licensedProducts: JwtPayload['licensed_products'];
}

// Shared by every authenticated Server Component layout across product web apps
// (LMS dashboard, and the leave/attendance/tasks module layouts): verify the
// JWT, resolve the full session from identity-service via the gateway, and
// redirect to /login or /change-password. Extracted to `@platform/ui-kit/server`
// so new module/product layouts don't duplicate this logic — behavior is
// unchanged from the original apps/web implementation.
export async function requireSession(callbackUrl: string): Promise<AuthenticatedSession> {
  const jwtPayload = await getJwtPayload();
  if (!jwtPayload) redirect(await loginRedirect(callbackUrl));

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const session = await getFullSession(cookieHeader);
  if (!session) redirect(await loginRedirect(callbackUrl));

  if (session.force_password_change) {
    const origin = authOrigin();
    redirect(origin ? `${origin}/change-password` : '/change-password');
  }

  return { session, cookieHeader, licensedProducts: jwtPayload.licensed_products };
}
