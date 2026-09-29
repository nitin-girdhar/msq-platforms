'use client';

import { useState } from 'react';
import { Button } from '@platform/ui-kit';
import { metaCampaigns, type CampaignSyncResult } from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  onSynced: () => void;
}

function summarize(result: CampaignSyncResult): string {
  return [
    `${result.ad_accounts} ad account${result.ad_accounts === 1 ? '' : 's'} walked`,
    `${result.fetched} campaigns fetched`,
    `${result.inserted} new for this tenant`,
    `${result.suggested} need confirmation`,
    `${result.unmapped} need mapping`,
    `${result.confirmed_untouched} already confirmed and left alone`,
    ...(result.other_tenant ? [`${result.other_tenant} belong to other tenants`] : []),
  ].join(' · ');
}

export default function FetchCampaignsButton({ tenantId, onSynced }: Props) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CampaignSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await metaCampaigns.sync(tenantId);
      setResult(res.data);
      onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-2 sm:w-auto">
      <Button variant="primary" onClick={handleFetch} disabled={pending} aria-busy={pending}>
        {pending && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        )}
        {pending ? 'Fetching campaigns…' : 'Fetch campaigns'}
      </Button>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#334155]">
          <p>{summarize(result)}</p>
          {result.unattributed.length > 0 && (
            <div className="mt-1 space-y-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[#475569]">
              <p className="font-semibold">
                {result.unattributed.length} campaign{result.unattributed.length === 1 ? '' : 's'} promote pages no tenant
                maps — map those pages on Meta Page Mapping, then fetch again:
              </p>
              <p>
                {[...new Set(result.unattributed.flatMap((c) => c.page_ids))].slice(0, 10).join(', ') || 'no promoted page'}
              </p>
            </div>
          )}
          {result.conflicts.length > 0 && (
            <div role="alert" className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
              {result.conflicts.length} campaign{result.conflicts.length === 1 ? '' : 's'} promote pages of more than one
              tenant and were skipped: {result.conflicts.slice(0, 5).map((c) => c.name ?? c.meta_campaign_id).join(', ')}
            </div>
          )}
          {result.errors.length > 0 && (
            <div role="alert" className="mt-1 space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
              {/* Not "N accounts": the sync records per-ACCOUNT failures (a
                  token that lost access) and per-CAMPAIGN ones (a row that
                  would not upsert) in the same list. */}
              <p className="font-semibold">
                {result.errors.length} problem{result.errors.length === 1 ? '' : 's'} during the fetch:
              </p>
              {result.errors.map((e, i) => (
                <p key={i}>
                  {e.ad_account_id ?? 'Unknown account'}: {e.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
