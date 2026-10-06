'use client';

import { useEffect, useRef, useState } from 'react';
import { users as usersApi } from '../../api/resources';
import { useUserAdminScope } from '../../providers/UserAdminScope';
import { FIELD_BASE, FIELD_LABEL, HINT } from './styles';
import type { ManagerCandidate } from './types';
import { shouldClearManager } from './managerSelection';

interface Props {
  value: string;
  onChange: (userId: string) => void;
  /** The home branch — who may manage this user is a question about one branch. */
  homeOrgId: string;
  /** Excluded from candidates: nobody reports to themselves. */
  excludeUserId?: string;
  /**
   * Display name of the manager the user already has. Shown as a "(current)"
   * option when that manager is not among this branch's candidates, so the
   * field shows the real value instead of looking blank.
   */
  currentManagerName?: string | null;
  disabled?: boolean;
}

/**
 * The user's manager, resolved against the home branch.
 *
 * Candidates come from the server, not from the loaded roster: the roster
 * carries each user's home org only, so anyone mapped into this branch from
 * elsewhere would be missing from a client-side filter.
 *
 * The list is regrouped and refetched whenever the home branch changes, and a
 * selection the new branch cannot honour is cleared — a manager valid in one
 * branch generally is not valid in another, and silently keeping them would
 * produce a save that fails on iam.check_reporting_line_membership(). See
 * shouldClearManager for why that never happens on the branch the form opened
 * with.
 */
export default function ManagerSelect({
  value, onChange, homeOrgId, excludeUserId, currentManagerName, disabled,
}: Props) {
  const [candidates, setCandidates] = useState<ManagerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which branch `candidates` belongs to. Until a fetch settles this lags
  // homeOrgId, and the clear effect must not judge the value against it.
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const initialHomeOrgId = useRef(homeOrgId);
  const { tenant_id: scopeTenantId } = useUserAdminScope();

  useEffect(() => {
    if (!homeOrgId) {
      setCandidates([]);
      setFetchedFor(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    usersApi.managerCandidates(homeOrgId, { tenant_id: scopeTenantId })
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
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setFetchedFor(homeOrgId);
      });

    return () => { cancelled = true; };
  }, [homeOrgId, excludeUserId, scopeTenantId]);

  useEffect(() => {
    if (shouldClearManager({
      value, homeOrgId, initialHomeOrgId: initialHomeOrgId.current, fetchedFor, loading, candidates,
    })) {
      onChange('');
    }
    // onChange is intentionally omitted: callers pass inline setters, and
    // depending on it would clear the field on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, loading, value, homeOrgId, fetchedFor]);

  const inBranch = candidates.filter((c) => c.in_branch);
  const tenantWide = candidates.filter((c) => !c.in_branch);
  const selected = candidates.find((c) => c.id === value);
  // A recorded manager this branch no longer lists (see shouldClearManager).
  const orphanValue = Boolean(value) && !selected && !loading;

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
        {orphanValue && (
          <option value={value}>{currentManagerName || 'Current manager'} (current)</option>
        )}
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

      {error && <p className="text-[0.6875rem] text-error">{error}</p>}
      {!error && !homeOrgId && <p className={HINT}>Pick a branch first.</p>}
      {!error && homeOrgId && <p className={HINT}>Set for the home branch only.</p>}

      {orphanValue && (
        <p className="rounded-lg border border-status-due/40 bg-status-due-container px-2.5 py-1.5 text-[0.71875rem] leading-snug text-on-status-due-container">
          {currentManagerName || 'The current manager'} is no longer an active manager option for this branch.
          It stays as-is unless you pick someone else.
        </p>
      )}

      {selected && !selected.in_branch && (
        <p className="rounded-lg border border-status-success/40 bg-status-success-container px-2.5 py-1.5 text-[0.71875rem] leading-snug text-on-status-success-container">
          {selected.full_name} isn&apos;t a member of this branch. Saving will also grant them access to it
          at weight 0 so they can be set as manager.
        </p>
      )}
    </div>
  );
}
