import { cookies } from 'next/headers';
import { GATEWAY_URL } from './server-session';
import { TENANT_COOKIE, type TenantOption } from './tenant-cookie';

// The admin-selected tenant, hoisted out of the individual table pages.
//
// It used to live only in each page's `?tenant_id=` search param, which meant
// (a) every tenant-scoped page re-fetched `/lookups/tenants` just to render its
// own copy of the dropdown, and (b) the selection was lost the moment you
// navigated to another table. It now lives in a cookie written by the top-level
// selector in the dashboard header, so one choice drives every fetch downstream.
//
// Advisory only — exactly as before. The real scoping/authorization check is the
// backend's required `tenant_id` query param plus the super_admin capability
// gate; a forged cookie buys nothing.
//
// TENANT_COOKIE / TenantOption live in ./tenant-cookie so the client selector can
// import them without pulling `next/headers` into the browser bundle.
export { TENANT_COOKIE, type TenantOption };

/** The selected tenant for this request, or undefined when none is chosen.
 *  An explicit `?tenant_id=` wins over the cookie so deep links still work. */
export async function getSelectedTenantId(
  searchParamTenantId?: string | undefined,
): Promise<string | undefined> {
  if (searchParamTenantId) return searchParamTenantId;
  const store = await cookies();
  return store.get(TENANT_COOKIE)?.value || undefined;
}

/** The tenant list for the selector. Fetched ONCE per request in the dashboard
 *  layout and passed down through context — not re-fetched per page. Returns []
 *  on failure, which renders as an empty dropdown rather than breaking the shell. */
export async function fetchTenants(cookieHeader: string): Promise<TenantOption[]> {
  const res = await fetch(`${GATEWAY_URL}/lookups/tenants`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data: Record<string, unknown>[] };
  return body.data.map((t) => ({ id: String(t['id']), name: String(t['name']) }));
}
