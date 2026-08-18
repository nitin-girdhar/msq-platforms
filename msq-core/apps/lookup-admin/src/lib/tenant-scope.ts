import { cookies } from 'next/headers';
import { GATEWAY_URL } from './server-session';
import { TENANT_COOKIE, ORG_COOKIE, type TenantOption, type OrgOption } from './tenant-cookie';

// The admin's active tenant, chosen once in the navbar and applied to every
// tenant-scoped screen underneath it. It lives in a cookie rather than a
// `tenant_id` search param so a page-to-page navigation (or a hard reload)
// keeps the scope — the old per-page selector reset to "— Select a tenant —"
// on every hop and had to be re-picked on each screen.
//
// Advisory only, exactly as the per-page selector was: the real authorization
// is the admin-service's required `tenant_id` query param + super-admin gate.
// Re-exported so server components keep a single import site for the scope.
export { TENANT_COOKIE, ORG_COOKIE, type TenantOption, type OrgOption };

export async function getSelectedTenantId(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(TENANT_COOKIE)?.value || undefined;
}

export async function getSelectedOrgId(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(ORG_COOKIE)?.value || undefined;
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

// Orgs for the navbar scope come from admin-service's /lookups/organizations,
// NOT identity-service's /orgs/all. /orgs/all is doubly wrong here: it projects
// only (id, name) — no tenant_id to filter on, so the switcher rendered an
// empty list — and it scopes rows to the CALLER's own tenant, so a super_admin
// scoped to another tenant would get that tenant's orgs missing entirely.
// /lookups/organizations is the same super-admin-gated, cross-tenant route the
// Organizations grid already reads, and it carries tenantId.
export async function fetchOrgs(cookieHeader: string): Promise<OrgOption[]> {
  const res = await fetch(`${GATEWAY_URL}/lookups/organizations`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    data: Array<{ id: string; name: string; tenantId: string; isActive?: boolean }>;
  };
  // Deactivated branches stay listable on their own admin grid but must never
  // be offered as an active scope.
  return body.data
    .filter((o) => o.isActive !== false)
    .map((o) => ({ id: String(o.id), name: o.name, tenant_id: String(o.tenantId) }));
}
