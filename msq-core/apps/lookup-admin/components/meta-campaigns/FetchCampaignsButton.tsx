'use client';

import { useState } from 'react';
import { Button } from '@platform/ui-kit';
import { metaCampaigns, type CampaignSyncResult } from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  onSynced: () => void;
  /** The fetch outcome (or its failure) — rendered by the page, not the button. */
  onResult: (result: CampaignSyncResult | null, error: string | null) => void;
}

export default function FetchCampaignsButton({ tenantId, onSynced, onResult }: Props) {
  const [pending, setPending] = useState(false);

  const handleFetch = async () => {
    setPending(true);
    onResult(null, null);
    try {
      const res = await metaCampaigns.sync(tenantId);
      onResult(res.data, null);
      onSynced();
    } catch (err) {
      onResult(null, err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Button variant="primary" onClick={handleFetch} disabled={pending} aria-busy={pending}>
      {pending && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-primary/40 border-t-on-primary" aria-hidden />
      )}
      {pending ? 'Fetching campaigns…' : 'Fetch Campaigns from Ad Accounts'}
    </Button>
  );
}
