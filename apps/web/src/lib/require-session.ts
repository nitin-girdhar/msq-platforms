import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';
import type { JwtPayload, SessionUser } from '@crm/types';
import { AUTH_COOKIE_NAME, JWT_ISSUER, JWT_AUDIENCE } from '@crm/auth-constants';

// API_GATEWAY_INTERNAL_URL is a server-only env var (no NEXT_PUBLIC_ prefix).
// It is never sent to the browser.
const API_GATEWAY = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

async function getJwtPayload(): Promise<JwtPayload | null> {
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
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
}

// Shared by every authenticated Server Component layout (dashboard, and the
// leave/attendance/tasks module layouts): verify the JWT, resolve the full
// session from identity-service via the gateway, and redirect to /login or
// /change-password exactly like the existing dashboard layout always has.
// Extracted so new module layouts don't duplicate this logic — behavior is
// unchanged for the existing CRM dashboard.
export async function requireSession(callbackUrl: string): Promise<AuthenticatedSession> {
  const jwtPayload = await getJwtPayload();
  if (!jwtPayload) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const session = await getFullSession(cookieHeader);
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);

  if (session.force_password_change) {
    redirect('/change-password');
  }

  return { session, cookieHeader };
}
