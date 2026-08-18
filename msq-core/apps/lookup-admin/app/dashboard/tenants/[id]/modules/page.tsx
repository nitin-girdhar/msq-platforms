import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import TenantModulesClient from '@/components/lookups/TenantModulesClient';
import type { TenantModuleRow } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Bespoke — entity.tenant_modules has no name/label shape and edits a fixed
// set of four checkboxes for one specific tenant, so it does not fit the
// shared [table] grid the way a row-per-record lookup does. Linked from the
// Tenants row's Edit modal rather than being a card of its own.
export default async function TenantModulesPage({ params }: PageProps) {
  const { id } = await params;
  const result = await getServerSession();
  if (!result) return null;

  const [modulesRes, tenantsRes] = await Promise.all([
    fetch(`${GATEWAY_URL}/tenants/${id}/modules`, {
      headers: { cookie: result.cookieHeader },
      cache: 'no-store',
    }),
    fetch(`${GATEWAY_URL}/lookups/tenants`, {
      headers: { cookie: result.cookieHeader },
      cache: 'no-store',
    }),
  ]);

  if (!modulesRes.ok) return <LookupLoadError title="Tenant Modules" status={modulesRes.status} />;

  const modulesBody = await modulesRes.json() as { data: TenantModuleRow[] };
  const tenantName = tenantsRes.ok
    ? ((await tenantsRes.json() as { data: Array<Record<string, unknown>> }).data
        .find((t) => String(t['id']) === id)?.['name'] as string | undefined)
    : undefined;

  return (
    <TenantModulesClient tenantId={id} tenantName={tenantName} initialModules={modulesBody.data} />
  );
}
