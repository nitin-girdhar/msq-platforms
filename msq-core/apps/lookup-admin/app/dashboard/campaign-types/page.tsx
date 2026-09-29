import Link from 'next/link';
import { getServerSession } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
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
      <div className="space-y-4 p-4 sm:p-6">
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to LMS
        </Link>
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Pick a tenant in the top bar to manage campaign types and rules.
        </p>
      </div>
    );
  }

  // Keyed by tenant so switching tenant drops the previous tenant's state.
  return <CampaignTypesClient key={selectedTenantId} tenantId={selectedTenantId} />;
}
