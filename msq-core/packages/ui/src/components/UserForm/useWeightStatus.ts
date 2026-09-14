'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '../../api/resources';
import type { WeightStatus } from './types';

/** `${org_id}:${campaign_type_id}` — the composite key every param/result uses. */
export function weightStatusKey(orgId: string, campaignTypeId: string): string {
  return `${orgId}:${campaignTypeId}`;
}

/**
 * Each selected (branch, campaign type) pool's current auto-assignment total,
 * keyed by `${org_id}:${campaign_type_id}` — weights are keyed per type as of
 * schema 1.49.0, so a branch's sales pool and hiring pool are independent
 * totals, not one number split across both.
 *
 * Advisory only. The sum-to-100 rule is enforced per-type on the dedicated
 * Assignment Weights screen; here it is reported so an admin can see what they
 * are walking into, and never blocks a save — most branches' pools currently
 * sit at 0%, and refusing to save would keep them there.
 *
 * `excludeUserId` drops the user being edited from the tally so their own new
 * number can be added to it rather than double-counted against their old one.
 */
export function useWeightStatus(
  pairs: Array<{ org_id: string; campaign_type_id: string }>,
  draftWeights: Record<string, number>,
  excludeUserId?: string,
): Record<string, WeightStatus> {
  const [others, setOthers] = useState<Record<string, { total: number; count: number }>>({});
  const [loaded, setLoaded] = useState<Set<string>>(new Set());

  // Sorted + joined so the effect keys off the SET of pairs, not array
  // identity — reordering rows must not refetch.
  const key = [...pairs.map((p) => weightStatusKey(p.org_id, p.campaign_type_id))].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const keys = key ? key.split(',') : [];
    if (keys.length === 0) return;

    Promise.all(keys.map(async (k) => {
      const [orgId, campaignTypeId] = k.split(':') as [string, string];
      try {
        const res = await usersApi.assignmentWeights(orgId, campaignTypeId);
        const rows = res.data.filter((r) => r.user_id !== excludeUserId);
        return [k, {
          total: rows.reduce((s, r) => s + Number(r.weight ?? 0), 0),
          count: rows.length,
        }] as const;
      } catch {
        // A pool whose weights can't be read reports nothing rather than a
        // wrong 0% — the row stays in the loading state.
        return null;
      }
    })).then((entries) => {
      if (cancelled) return;
      const next: Record<string, { total: number; count: number }> = {};
      const seen = new Set<string>();
      for (const e of entries) {
        if (!e) continue;
        next[e[0]] = e[1];
        seen.add(e[0]);
      }
      setOthers(next);
      setLoaded(seen);
    });

    return () => { cancelled = true; };
  }, [key, excludeUserId]);

  const result: Record<string, WeightStatus> = {};
  for (const p of pairs) {
    const k = weightStatusKey(p.org_id, p.campaign_type_id);
    const base = others[k];
    if (!base || !loaded.has(k)) {
      result[k] = { status: 'loading', total: 0, userCount: 0 };
      continue;
    }
    const draft = draftWeights[k] ?? 0;
    const total = base.total + draft;
    const userCount = base.count + (draft > 0 ? 1 : 0);
    result[k] = {
      status: total === 100 ? 'ok' : total === 0 ? 'zero' : 'off',
      total,
      userCount,
    };
  }
  return result;
}
