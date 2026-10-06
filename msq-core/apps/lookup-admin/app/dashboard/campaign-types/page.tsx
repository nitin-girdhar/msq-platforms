import Link from 'next/link';
import { PageBody, PageHeader } from '@platform/ui-kit';
import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId, getSelectedTenantName } from '@/src/lib/tenant-scope';
import CampaignTypesClient from '@/components/campaign-types/CampaignTypesClient';

export const dynamic = 'force-dynamic';

// Bespoke screen (1.51.0), same precedent as meta-campaigns: the ORDERED rule
// list (reorder, first match wins) has no equivalent in the generic [table]
// grid. No guard here: app/dashboard/layout.tsx already gates the subtree with
// canOpenLookupAdmin(session); leads-service re-checks super_admin on every call.
export default async function CampaignTypesPage() {
  const result = await getServerSession();
  if (!result) return null;

  const selectedTenantId = await getSelectedTenantId();
  if (!selectedTenantId) {
    return (
      <>
        <PageHeader
          title="Campaign Types & Rules"
          actions={<Link href="/dashboard/m/lms" className="inline-flex min-h-[2.75rem] items-center text-xs font-semibold text-primary hover:underline sm:min-h-0">← Back to LMS</Link>}
        />
        <PageBody>
          <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
            Pick a tenant in the top bar to manage campaign types and rules.
          </p>
        </PageBody>
      </>
    );
  }

  // Keyed by tenant so switching tenant drops the previous tenant's state.
  return (
    <CampaignTypesClient
      key={selectedTenantId}
      tenantId={selectedTenantId}
      tenantName={await getSelectedTenantName()}
    />
  );
}
