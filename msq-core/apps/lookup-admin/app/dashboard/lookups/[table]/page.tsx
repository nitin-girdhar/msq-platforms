import { notFound } from 'next/navigation';
import { TABLE_CONFIG } from '@/src/lib/lookupTableConfig';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
import LookupTableShell from '@/components/lookups/LookupTableShell';
import LookupLoadError from '@/components/lookups/LookupLoadError';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ table: string }>;
  searchParams: Promise<{ tenant_id?: string }>;
}

export default async function LookupTablePage({ params, searchParams }: PageProps) {
  const { table } = await params;
  const config = TABLE_CONFIG[table];
  if (!config) notFound();

  // The dashboard layout has already gated this route to super_admin rank;
  // we still need the session here for the cookie header used to fetch rows,
  // and to fall back gracefully if the session expired between requests.
  const result = await getServerSession();
  if (!result) notFound();

  const { cookieHeader } = result;

  // The tenant comes from the header selector (a cookie), resolved once in the
  // dashboard layout; an explicit `?tenant_id=` still wins so deep links work.
  // This page no longer fetches the tenant list — the layout owns that.
  const { tenant_id: searchParamTenantId } = await searchParams;
  const selectedTenantId = await getSelectedTenantId(searchParamTenantId);

  let rows: Record<string, unknown>[] = [];

  if (config.tenantScoped) {
    if (selectedTenantId) {
      const res = await fetch(`${GATEWAY_URL}/lookups/${table}?tenant_id=${selectedTenantId}`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      });
      // A tenant not yet selected is a normal empty state; a denied or failed
      // fetch is not — reporting it as "no rows" would read as "this tenant has
      // nothing configured" and invite the admin to re-create existing data.
      if (res.ok) {
        const body = await res.json() as { success: true; data: Record<string, unknown>[] };
        rows = body.data;
      } else {
        return <LookupLoadError title={config.title} status={res.status} />;
      }
    }
  } else {
    const res = await fetch(`${GATEWAY_URL}/lookups/${table}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });

    // notFound() here is the wrong signal: the slug IS a real route (it is in
    // TABLE_CONFIG), so a failed fetch is an authorization or backend problem,
    // not a missing page. Rendering Next's 404 hid a platform-wide 403 behind
    // "This page could not be found".
    if (!res.ok) {
      return <LookupLoadError title={config.title} status={res.status} />;
    }

    const body = await res.json() as { success: true; data: Record<string, unknown>[] };
    rows = body.data;
  }

  return (
    <LookupTableShell
      table={table}
      config={config}
      rows={rows}
      tenantScoped={config.tenantScoped}
      selectedTenantId={selectedTenantId}
    />
  );
}
