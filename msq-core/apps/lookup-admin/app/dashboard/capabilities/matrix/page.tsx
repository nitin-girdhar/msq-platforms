import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { redirect } from 'next/navigation';
import { PageHeader, PageBody } from '@platform/ui-kit';
import CapabilityMatrixClient from '@/components/capabilities/CapabilityMatrixClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ tenant_id?: string }>;
}

// Same shape as the [table] lookup page: advisory tenant selector fed from
// the URL, real scoping enforced server-side per request.
export default async function CapabilityMatrixPage({ searchParams }: PageProps) {
  const result = await getServerSession();
  if (!result) redirect('/login');
  const { cookieHeader } = result;

  const { tenant_id: selectedTenantId } = await searchParams;

  const tenantsRes = await fetch(`${GATEWAY_URL}/lookups/tenants`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  const tenants = tenantsRes.ok
    ? ((await tenantsRes.json()) as { data: Record<string, unknown>[] }).data.map((t) => ({
        id: String(t['id']),
        name: String(t['name']),
      }))
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Capability Matrix"
        subtitle="Grant or revoke capabilities for a role, per tenant."
      />
      <PageBody>
        <CapabilityMatrixClient tenants={tenants} selectedTenantId={selectedTenantId} />
      </PageBody>
    </div>
  );
}
