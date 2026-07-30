import { getServerSession } from '@/src/lib/server-session';
import { redirect } from 'next/navigation';
import { PageHeader, PageBody } from '@platform/ui-kit';
import CapabilityMatrixClient from '@/components/capabilities/CapabilityMatrixClient';

export const dynamic = 'force-dynamic';

// Same shape as the [table] lookup page: the tenant comes from the ONE header
// selector (resolved in the dashboard layout and read from context), real scoping
// enforced server-side per request. This page no longer fetches the tenant list.
export default async function CapabilityMatrixPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Capability Matrix"
        subtitle="Grant or revoke capabilities for a role, per tenant."
      />
      <PageBody>
        <CapabilityMatrixClient />
      </PageBody>
    </div>
  );
}
