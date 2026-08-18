import { notFound } from 'next/navigation';
import { TABLE_CONFIG } from '@/src/lib/lookupTableConfig';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedOrgId } from '@/src/lib/tenant-scope';
import LookupTableShell from '@/components/lookups/LookupTableShell';
import LookupLoadError from '@/components/lookups/LookupLoadError';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ table: string }>;
}

export default async function LookupTablePage({ params }: PageProps) {
  const { table } = await params;
  const config = TABLE_CONFIG[table];
  if (!config) notFound();

  // The dashboard layout has already gated this route to super_admin rank;
  // we still need the session here for the cookie header used to fetch rows,
  // and to fall back gracefully if the session expired between requests.
  const result = await getServerSession();
  if (!result) notFound();

  const { cookieHeader } = result;

  // Scope comes from the app-wide selectors in the navbar (dashboard/layout.tsx).
  const selectedTenantId = await getSelectedTenantId();
  const selectedOrgId = config.scope === 'org' ? await getSelectedOrgId() : undefined;

  let rows: Record<string, unknown>[] = [];

  async function fetchRows(query: string) {
    const res = await fetch(`${GATEWAY_URL}/lookups/${table}${query}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false as const, status: res.status };
    const body = await res.json() as { success: true; data: Record<string, unknown>[] };
    return { ok: true as const, data: body.data };
  }

  if (config.scope === 'org') {
    // Both a tenant AND an org must be picked before there is anything to
    // scope the request to — an org id alone is ambiguous cross-tenant, and
    // the navbar's OrgScopeSwitcher is disabled without a tenant anyway.
    if (selectedTenantId && selectedOrgId) {
      const result = await fetchRows(`?tenant_id=${selectedTenantId}&org_id=${selectedOrgId}`);
      if (!result.ok) return <LookupLoadError title={config.title} status={result.status} />;
      rows = result.data;
    }
  } else if (config.scope === 'tenant') {
    if (selectedTenantId) {
      const result = await fetchRows(`?tenant_id=${selectedTenantId}`);
      // A tenant/org not yet selected is a normal empty state; a denied or
      // failed fetch is not — reporting it as "no rows" would read as "this
      // tenant has nothing configured" and invite the admin to re-create
      // existing data.
      if (!result.ok) return <LookupLoadError title={config.title} status={result.status} />;
      rows = result.data;
    }
  } else {
    const result = await fetchRows('');
    // notFound() here is the wrong signal: the slug IS a real route (it is in
    // TABLE_CONFIG), so a failed fetch is an authorization or backend problem,
    // not a missing page. Rendering Next's 404 hid a platform-wide 403 behind
    // "This page could not be found".
    if (!result.ok) return <LookupLoadError title={config.title} status={result.status} />;
    rows = result.data;
  }

  return (
    <LookupTableShell
      table={table}
      config={config}
      rows={rows}
      selectedTenantId={selectedTenantId}
      selectedOrgId={selectedOrgId}
    />
  );
}
