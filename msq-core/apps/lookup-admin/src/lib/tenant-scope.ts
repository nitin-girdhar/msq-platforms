import { cookies } from 'next/headers';
import { GATEWAY_URL } from './server-session';
import { TENANT_COOKIE, type TenantOption } from './tenant-cookie';

// The admin's active tenant, chosen once in the navbar and applied to every
// tenant-scoped screen underneath it. It lives in a cookie rather than a
// `tenant_id` search param so a page-to-page navigation (or a hard reload)
// keeps the scope — the old per-page selector reset to "— Select a tenant —"
// on every hop and had to be re-picked on each screen.
//
// Advisory only, exactly as the per-page selector was: the real authorization
// is the admin-service's required `tenant_id` query param + super-admin gate.
// Re-exported so server components keep a single import site for the scope.
export { TENANT_COOKIE, type TenantOption };

export async function getSelectedTenantId(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(TENANT_COOKIE)?.value || undefined;
}

export async function fetchTenants(cookieHeader: string): Promise<TenantOption[]> {
  const res = await fetch(`${GATEWAY_URL}/lookups/tenants`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data: Record<string, unknown>[] };
  return body.data.map((t) => ({ id: String(t['id']), name: String(t['name']) }));
}
