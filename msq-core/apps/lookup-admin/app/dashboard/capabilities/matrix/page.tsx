import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedTenantName } from '@/src/lib/tenant-scope';
import { redirect } from 'next/navigation';
import CapabilityMatrixShell from '@/components/capabilities/CapabilityMatrixShell';

export const dynamic = 'force-dynamic';

// Same shape as the [table] lookup page: tenant scope comes from the app-wide
// navbar selector, real scoping enforced server-side per request.
export default async function CapabilityMatrixPage() {
  const result = await getServerSession();
  if (!result) redirect('/login');

  const selectedTenantId = await getSelectedTenantId();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <CapabilityMatrixShell selectedTenantId={selectedTenantId} tenantName={await getSelectedTenantName()} />
    </div>
  );
}
