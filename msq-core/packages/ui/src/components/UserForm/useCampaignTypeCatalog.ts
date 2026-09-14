'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '../../api/resources';
import type { CampaignTypeOption } from './types';

interface CampaignTypeCatalog {
  campaignTypes: CampaignTypeOption[];
  loading: boolean;
  error: string | null;
}

/**
 * The tenant's campaign-type catalog, fetched once per mounted form — modeled
 * on useRoleCatalog.
 *
 * Backed by identity-service's own read-through (gated on admin.team.manage),
 * not leads-service's `/campaign-types` (gated on LMS_CAMPAIGN_TYPES_VIEW,
 * which not every admin.team.manage holder has). A fetch failure degrades to
 * an "unavailable" state exactly like useRoleCatalog, rather than crashing the
 * form — OrgAssignmentsField still needs to render *something* for whatever
 * weights the user already has.
 */
export function useCampaignTypeCatalog(enabled = true): CampaignTypeCatalog {
  const [campaignTypes, setCampaignTypes] = useState<CampaignTypeOption[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    setLoading(true);
    usersApi.campaignTypeCatalog()
      .then((res) => {
        if (cancelled) return;
        setCampaignTypes(res.data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load campaign types.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled]);

  return { campaignTypes, loading, error };
}
