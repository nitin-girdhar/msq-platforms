import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
import { redirect } from 'next/navigation';
import { PageHeader, PageBody } from '@platform/ui-kit';
import CapabilityMatrixClient from '@/components/capabilities/CapabilityMatrixClient';

export const dynamic = 'force-dynamic';

// Same shape as the [table] lookup page: tenant scope comes from the app-wide
// navbar selector, real scoping enforced server-side per request.
export default async function CapabilityMatrixPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const selectedTenantId = await getSelectedTenantId();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Capability Matrix"
        subtitle="Grant or revoke capabilities for a role, per tenant."
      />
      <PageBody>
        <CapabilityMatrixClient selectedTenantId={selectedTenantId} />
      </PageBody>
    </div>
  );
}
