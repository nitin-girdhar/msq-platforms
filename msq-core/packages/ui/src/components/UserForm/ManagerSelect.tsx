'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '../../api/resources';
import { FIELD_BASE, FIELD_LABEL, HINT } from './styles';
import type { ManagerCandidate } from './types';

interface Props {
  value: string;
  onChange: (userId: string) => void;
  /** The home branch — who may manage this user is a question about one branch. */
  homeOrgId: string;
  /** Excluded from candidates: nobody reports to themselves. */
  excludeUserId?: string;
  disabled?: boolean;
}

/**
 * The user's manager, resolved against the home branch.
 *
 * Candidates come from the server, not from the loaded roster: the roster
 * carries each user's home org only, so anyone mapped into this branch from
 * elsewhere would be missing from a client-side filter.
 *
 * The list is regrouped and refetched whenever the home branch changes, and the
 * current selection is cleared — a manager valid in one branch generally is not
 * valid in another, and silently keeping them would produce a save that fails on
 * iam.check_reporting_line_membership().
 */
export default function ManagerSelect({ value, onChange, homeOrgId, excludeUserId, disabled }: Props) {
  const [candidates, setCandidates] = useState<ManagerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!homeOrgId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    usersApi.managerCandidates(homeOrgId)
      .then((res) => {
        if (cancelled) return;
        setCandidates(res.data.filter((c) => c.id !== excludeUserId));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load managers.');
        setCandidates([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [homeOrgId, excludeUserId]);

  // Clear a selection the new branch cannot honour. Runs only once the fetch has
  // settled, so the value survives the in-flight window.
  useEffect(() => {
    if (loading || !value) return;
    if (!candidates.some((c) => c.id === value)) onChange('');
    // onChange is intentionally omitted: callers pass inline setters, and
    // depending on it would clear the field on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, loading, value]);

  const inBranch = candidates.filter((c) => c.in_branch);
  const tenantWide = candidates.filter((c) => !c.in_branch);
  const selected = candidates.find((c) => c.id === value);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="uf-manager" className={FIELD_LABEL}>Manager</label>
      <select
        id="uf-manager"
        value={value}
        disabled={disabled || loading || !homeOrgId}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_BASE}
      >
        <option value="">{loading ? 'Loading…' : '— None —'}</option>
        {inBranch.length > 0 && (
          <optgroup label="In this branch">
            {inBranch.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name} — {c.role_label}</option>
            ))}
          </optgroup>
        )}
        {tenantWide.length > 0 && (
          <optgroup label="Tenant-wide">
            {tenantWide.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name} — {c.role_label}</option>
            ))}
          </optgroup>
        )}
      </select>

      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {!error && !homeOrgId && <p className={HINT}>Pick a branch first.</p>}
      {!error && homeOrgId && <p className={HINT}>Set for the home branch only.</p>}

      {selected && !selected.in_branch && (
        <p className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-1.5 text-[11.5px] leading-snug text-[#065F46]">
          {selected.full_name} isn&apos;t a member of this branch. Saving will also grant them access to it
          at weight 0 so they can be set as manager.
        </p>
      )}
    </div>
  );
}
