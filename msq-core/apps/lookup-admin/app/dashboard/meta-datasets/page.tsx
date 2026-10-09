import { getServerSession } from '@/src/lib/server-session';
import { fetchTenants, getSelectedTenantId } from '@/src/lib/tenant-scope';
import MetaDatasetsClient from '@/components/meta-datasets/MetaDatasetsClient';

export const dynamic = 'force-dynamic';

// Bespoke screen (1.79.0). Platform-level data OWNED by tenants: it lists every tenant's portfolios and
// datasets (filterable), so it takes the tenant LIST rather than a single selected tenant. The session's own
// tenant is only the starting filter. Gated by app/dashboard/layout.tsx, then per call by the gateway's
// superAdminGuard and meta-conversion-api's rank check; the composite foreign keys keep a dataset under
// the tenant that owns its portfolio.
export default async function MetaDatasetsPage() {
  const result = await getServerSession();
  if (!result) return null;
  const [tenants, selectedTenantId] = await Promise.all([fetchTenants(result.cookieHeader), getSelectedTenantId()]);
  return <MetaDatasetsClient tenants={tenants} initialTenantId={selectedTenantId} />;
}
