'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '../../api/resources';
import type { WeightStatus } from './types';

/**
 * Each selected branch's current auto-assignment total, keyed by org id.
 *
 * Advisory only. The sum-to-100 rule is enforced on the dedicated Assignment
 * Weights screen; here it is reported so an admin can see what they are walking
 * into, and never blocks a save — 22 of 26 production branches currently sit at
 * 0%, and refusing to save would keep them there.
 *
 * `excludeUserId` drops the user being edited from the tally so their own new
 * number can be added to it rather than double-counted against their old one.
 */
export function useWeightStatus(
  orgIds: string[],
  draftWeights: Record<string, number>,
  excludeUserId?: string,
): Record<string, WeightStatus> {
  const [others, setOthers] = useState<Record<string, { total: number; count: number }>>({});
  const [loaded, setLoaded] = useState<Set<string>>(new Set());

  // Sorted + joined so the effect keys off the SET of branches, not the array
  // identity — reordering rows must not refetch.
  const key = [...orgIds].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) return;

    Promise.all(ids.map(async (orgId) => {
      try {
        const res = await usersApi.assignmentWeights(orgId);
        const rows = res.data.filter((r) => r.user_id !== excludeUserId);
        return [orgId, {
          total: rows.reduce((s, r) => s + Number(r.weight ?? 0), 0),
          count: rows.length,
        }] as const;
      } catch {
        // A branch whose weights can't be read reports nothing rather than a
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
  for (const orgId of orgIds) {
    const base = others[orgId];
    if (!base || !loaded.has(orgId)) {
      result[orgId] = { status: 'loading', total: 0, userCount: 0 };
      continue;
    }
    const total = base.total + (draftWeights[orgId] ?? 0);
    const userCount = base.count + ((draftWeights[orgId] ?? 0) > 0 ? 1 : 0);
    result[orgId] = {
      status: total === 100 ? 'ok' : total === 0 ? 'zero' : 'off',
      total,
      userCount,
    };
  }
  return result;
}
