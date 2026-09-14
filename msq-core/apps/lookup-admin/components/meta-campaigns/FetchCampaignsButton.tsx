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
    `${result.fetched} fetched`,
    `${result.inserted} new`,
    `${result.suggested} need confirmation`,
    `${result.unmapped} need mapping`,
    `${result.confirmed_untouched} already confirmed and left alone`,
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
