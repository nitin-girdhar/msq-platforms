import { notFound } from 'next/navigation';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import UsersShell from '@/components/users/UsersShell';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import type { UserRow } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  // The dashboard layout has already gated this route to super_admin rank;
  // we still need the session here for the cookie header used to fetch
  // users, and to fall back gracefully if the session expired between
  // requests — same pattern as app/dashboard/lookups/[table]/page.tsx.
  const result = await getServerSession();
  if (!result) notFound();

  const { session, cookieHeader } = result;

  const res = await fetch(`${GATEWAY_URL}/users`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });

  // notFound() here was the wrong signal: /dashboard/users IS a real route, so a
  // failed fetch is an authorization or backend problem, not a missing page.
  // Rendering Next's 404 hid the gateway's own status behind "Page not found" —
  // the same defect already fixed on the lookups screen (see
  // app/dashboard/lookups/[table]/page.tsx).
  if (!res.ok) {
    console.error(`[users] GET ${GATEWAY_URL}/users failed: ${res.status} ${res.statusText}`);
    return <LookupLoadError title="Users" status={res.status} />;
  }

  const body = await res.json() as { success: true; data: UserRow[] };

  return <UsersShell users={body.data} currentUserId={session.id} />;
}
