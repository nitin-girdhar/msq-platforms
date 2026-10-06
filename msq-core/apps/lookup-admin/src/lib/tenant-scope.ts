import { cache } from 'react';
import { GATEWAY_URL, getServerSession } from './server-session';
import type { TenantOption } from './tenant-cookie';

// The tenant and branch every SA screen acts on are the SESSION's — the same
// tenant/branch switcher (BranchSwitcher) every other tool's navbar carries.
// There used to be a separate SA-only Tenant/Org selection kept in cookies, so
// the SA console and LMS/HRMS/Tasks/Admin could silently sit in two different
// tenants; one switcher now scopes them all.
//
// Still advisory as far as authorization goes: the super-admin-only APIs keep
// their required, server-validated `tenant_id`/`org_id` params; this only
// decides which values the pages send. Every page calls these two helpers, so
// no page changed when the source moved from cookies to the session.
export type { TenantOption };

// One /auth/me per request, however many of the helpers a page calls.
const scopeSession = cache(getServerSession);

export async function getSelectedTenantId(): Promise<string | undefined> {
  return (await scopeSession())?.session.tenant_id || undefined;
}

// The acting tenant's NAME, for the PageHeader `scope` chip every tenant-scoped
// screen carries. Free — it rides the same cached /auth/me as the id above, and
// is always consistent with it: /auth/me resolves both from the TARGET org's
// tenant (auth.repository.ts findUser: `tgt.tenant_id`, `t.name`), not the
// user's home tenant, so a cross-tenant switch moves them together.
//
// Why screens show this at all: login always re-mints the session into the
// user's HOME tenant, so a super admin who switched tenant, edited, and logged
// back in lands on a different tenant's rows — indistinguishable from an edit
// that failed to save unless the page names its tenant.
export async function getSelectedTenantName(): Promise<string | undefined> {
  return (await scopeSession())?.session.tenant_name || undefined;
}

// "All branches" (session.all_branches) means no single branch is selected —
// tenant-level screens then span the tenant, and branch-level lookups ask for
// a branch. The token still carries a real org_id in that state, which is why
// the claim, not the org_id, decides.
export async function getSelectedOrgId(): Promise<string | undefined> {
  const s = (await scopeSession())?.session;
  if (!s || s.all_branches) return undefined;
  return s.org_id || undefined;
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
