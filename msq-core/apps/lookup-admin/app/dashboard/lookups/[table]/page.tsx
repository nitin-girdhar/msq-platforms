import { notFound } from 'next/navigation';
import { TABLE_CONFIG } from '@/src/lib/lookupTableConfig';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import LookupTableShell from '@/components/lookups/LookupTableShell';

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

  const { tenant_id: selectedTenantId } = await searchParams;

  let rows: Record<string, unknown>[] = [];
  let tenants: Array<{ id: string; name: string }> = [];

  if (config.tenantScoped) {
    // Advisory-only selector data — the real scoping/authorization check is
    // the backend's required `tenant_id` query param + RANKS.SUPER_ADMIN gate.
    const tenantsRes = await fetch(`${GATEWAY_URL}/lookups/tenants`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (tenantsRes.ok) {
      const tenantsBody = await tenantsRes.json() as { success: true; data: Record<string, unknown>[] };
      tenants = tenantsBody.data.map((t) => ({ id: String(t['id']), name: String(t['name']) }));
    }

    if (selectedTenantId) {
      const res = await fetch(`${GATEWAY_URL}/lookups/${table}?tenant_id=${selectedTenantId}`, {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
      });
      // A tenant not yet selected (or an invalid one) is a normal empty
      // state here, not a 404 — only fall through to [] on failure.
      if (res.ok) {
        const body = await res.json() as { success: true; data: Record<string, unknown>[] };
        rows = body.data;
      }
    }
  } else {
    const res = await fetch(`${GATEWAY_URL}/lookups/${table}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });

    if (!res.ok) {
      notFound();
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
      tenants={tenants}
      selectedTenantId={selectedTenantId}
    />
  );
}
