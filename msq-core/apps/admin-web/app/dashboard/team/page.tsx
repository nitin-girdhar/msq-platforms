import { redirect } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import LoadError from '@/components/team/LoadError';
import TeamShell from '@/components/team/TeamShell';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const { session, cookieHeader } = result;

  // No org_id param: identity-service scopes /users to the caller's own
  // org/tenant from the gateway-verified session (see users.service.ts).
  // page_size=500 is the schema's max (users.schema.ts) — the grid does its
  // own client-side paging/sorting/filtering below, so the whole roster is
  // fetched in one request rather than driving page/page_size from the UI.
  // Branches are fetched alongside the roster because the user form assigns
  // people to them. A failure here is not fatal — the form falls back to the
  // actor's own branch rather than blocking the whole page.
  const [res, orgsRes] = await Promise.all([
    fetch(`${GATEWAY_URL}/users?page_size=500`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
    fetch(`${GATEWAY_URL}/orgs/all`, { headers: { cookie: cookieHeader }, cache: 'no-store' }),
  ]);

  if (!res.ok) {
    console.error(`[team] GET ${GATEWAY_URL}/users failed: ${res.status} ${res.statusText}`);
    return <LoadError title="Team" status={res.status} />;
  }

  let orgs: Array<{ id: string; name: string }> = [];
  if (orgsRes.ok) {
    const orgsData = await orgsRes.json() as { data?: Array<{ id: string; name: string }> };
    orgs = Array.isArray(orgsData.data) ? orgsData.data.map((o) => ({ id: o.id, name: o.name })) : [];
  } else {
    console.error(`[team] GET ${GATEWAY_URL}/orgs/all failed: ${orgsRes.status} ${orgsRes.statusText}`);
  }

  const body = await res.json() as { data?: Record<string, unknown>[]; total?: number };
  const raw = Array.isArray(body.data) ? body.data : [];
  const total = typeof body.total === 'number' ? body.total : raw.length;
  const users: SessionUser[] = raw.map((u) => ({
    ...u,
    name: (u.full_name ?? u.name ?? '') as string,
    role: (u.role_name ?? u.role ?? '') as SessionUser['role'],
    role_label: (u.role_label ?? '') as string,
    rank: Number(u.rank ?? 0),
    org_id: (u.org_id ?? '') as string,
    org_name: (u.org_name ?? '') as string,
    tenant_id: (u.tenant_id ?? '') as string,
    tenant_name: (u.tenant_name ?? '') as string,
    manager_name: (u.manager_name ?? null) as string | null,
  })) as SessionUser[];

  return <TeamShell users={users} actor={session} total={total} orgs={orgs} />;
}
