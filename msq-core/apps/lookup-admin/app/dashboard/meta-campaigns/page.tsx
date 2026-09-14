import Link from 'next/link';
import { getServerSession, GATEWAY_URL } from '@/src/lib/server-session';
import { getSelectedTenantId } from '@/src/lib/tenant-scope';
import LookupLoadError from '@/components/lookups/LookupLoadError';
import MetaCampaignsClient from '@/components/meta-campaigns/MetaCampaignsClient';
import type { MetaCampaignRow, CampaignTypeRow } from '@/src/lib/api/client';

export const dynamic = 'force-dynamic';

const TITLE = 'Meta Campaign Mapping';

// Bespoke screen, same precedent as meta-mappings and lead-stage-capi-events:
// ext.meta_campaigns has no name/label/is_active catalog shape, and the value
// of this screen — the dry-run reclassification preview — has no equivalent in
// the generic [table] grid at all.
//
// No guard here: app/dashboard/layout.tsx already gates the whole subtree with
// canOpenLookupAdmin(session). getServerSession() is still called, for the
// cookie header and to degrade cleanly if the session expired mid-request.
export default async function MetaCampaignsPage() {
  const result = await getServerSession();
  if (!result) return null;
  const { cookieHeader } = result;

  const selectedTenantId = await getSelectedTenantId();

  if (!selectedTenantId) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">
          ← Back to LMS
        </Link>
        <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
          Pick a tenant in the top bar to manage Meta campaign mapping.
        </p>
      </div>
    );
  }

  const campaignsRes = await fetch(
    `${GATEWAY_URL}/meta/campaigns?tenant_id=${encodeURIComponent(selectedTenantId)}`,
    { headers: { cookie: cookieHeader }, cache: 'no-store' },
  );
  if (!campaignsRes.ok) return <LookupLoadError title={TITLE} status={campaignsRes.status} />;

  const campaignsBody = (await campaignsRes.json()) as { data: MetaCampaignRow[] };

  // Campaign types feed every confirm dialog's dropdown. Best-effort, same
  // shape as meta-mappings' pagesUnavailable: a failed or empty catalog must
  // not take the whole screen down when the campaign grids themselves loaded
  // fine. See the KNOWN BACKEND BUG note on `campaignTypes` in
  // src/lib/api/client.ts — this route does not actually honor
  // ?tenant_id=, so what comes back is the CALLER's own tenant's types.
  let campaignTypes: CampaignTypeRow[] = [];
  let campaignTypesUnavailable = false;
  try {
    const typesRes = await fetch(
      `${GATEWAY_URL}/campaign-types?tenant_id=${encodeURIComponent(selectedTenantId)}`,
      { headers: { cookie: cookieHeader }, cache: 'no-store' },
    );
    if (typesRes.ok) {
      const typesBody = (await typesRes.json()) as { data: CampaignTypeRow[] };
      campaignTypes = typesBody.data.filter((t) => t.is_active);
    } else {
      campaignTypesUnavailable = true;
    }
  } catch {
    campaignTypesUnavailable = true;
  }

  return (
    <MetaCampaignsClient
      tenantId={selectedTenantId}
      rows={campaignsBody.data}
      campaignTypes={campaignTypes}
      campaignTypesUnavailable={campaignTypesUnavailable}
    />
  );
}
