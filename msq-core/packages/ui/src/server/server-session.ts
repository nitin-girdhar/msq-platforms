import { cookies } from 'next/headers';
import type { JwtPayload, SessionUser } from '@platform/types';
import { AUTH_COOKIE_NAME } from '@platform/auth-constants';
import { verifySessionJwt } from '../auth/verify-edge';

// Server-only session helpers — consumed via `@platform/ui-kit/server`, never
// from a client bundle. Shared by every product web app (LMS today; HR/Task
// later): verify the JWT and resolve the full session from identity-service via
// the gateway. Zero product/domain knowledge lives here.
export const GATEWAY_URL = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

export interface ServerSession {
  session: SessionUser;
  cookieHeader: string;
  /** Products the acting tenant has licensed, straight off the verified JWT —
   *  drives the product switcher. UX convenience only; the gateway's
   *  entitlement gate remains the authoritative DB-backed check. */
  licensedProducts: JwtPayload['licensed_products'];
}

export async function getServerSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  // RS256 (public key) or legacy HS256, selected by the token's alg — same
  // verifier the product middleware uses. Product apps hold only JWT_PUBLIC_KEY.
  const payload: JwtPayload | null = await verifySessionJwt(token);
  if (!payload) return null;

  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ');

  try {
    const res = await fetch(`${GATEWAY_URL}/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json() as { data: { user: SessionUser } };
    return { session: data.data.user, cookieHeader, licensedProducts: payload.licensed_products };
  } catch {
    return null;
  }
}
