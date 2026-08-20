'use client';

import { useMemo } from 'react';
import { useDropdown } from '../../hooks/useDropdown';
import { rolesForDepartment } from './DepartmentSelect';
import { FIELD_LABEL, FIELD_SM, HINT } from './styles';
import { useWeightStatus } from './useWeightStatus';
import type { BranchOption, OrgAssignment, RoleOption, WeightStatus } from './types';

interface Props {
  branches: BranchOption[];
  assignments: OrgAssignment[];
  onChange: (next: OrgAssignment[]) => void;
  homeOrgId: string;
  onHomeChange: (orgId: string) => void;
  roles: RoleOption[];
  departmentId: string;
  /** Multi-branch needs tenant-admin authority; below that the branch set is fixed. */
  canPickBranches: boolean;
  disabled?: boolean;
  /** Editing an existing user — excluded from each branch's weight tally. */
  excludeUserId?: string;
}

/**
 * Which branches a user works in, and — once there is more than one — their role
 * and lead-assignment weight in each.
 *
 * The single-branch case is deliberately not a one-row table: most users work in
 * one branch and must not pay the multi-branch case's complexity. One branch is
 * silently home, with role and weight inline.
 */
export default function OrgAssignmentsField({
  branches, assignments, onChange, homeOrgId, onHomeChange,
  roles, departmentId, canPickBranches, disabled, excludeUserId,
}: Props) {
  const { open, setOpen, search, setSearch, rootRef, searchInputRef } = useDropdown();

  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.id, b.name])),
    [branches],
  );

  /**
   * A selected branch's name, or an honest admission that we don't have one.
   *
   * This used to fall back to the raw org_id. A UUID in a chip reads as data —
   * as though the branch were genuinely called that — when it actually means the
   * branch list failed to load or came back without this branch in it. The id
   * stays on the `title` so support can still recover it.
   */
  const label = (orgId: string) => branchName.get(orgId) ?? 'Unknown branch';

  const draftWeights = useMemo(() => {
    const w: Record<string, number> = {};
    for (const a of assignments) w[a.org_id] = a.lead_assignment_weight;
    return w;
  }, [assignments]);

  const weightStatus = useWeightStatus(
    assignments.map((a) => a.org_id),
    draftWeights,
    excludeUserId,
  );

  const selectableRoles = useMemo(
    () => rolesForDepartment(roles, departmentId),
    [roles, departmentId],
  );

  const selectedIds = new Set(assignments.map((a) => a.org_id));
  const available = branches.filter(
    (b) => !selectedIds.has(b.id) && (!search.trim() || b.name.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const addBranch = (orgId: string) => {
    // New rows inherit the home branch's current role as a convenience
    // default — still just a starting point, fully editable per row.
    const homeRoleId = assignments.find((a) => a.org_id === homeOrgId)?.role_id ?? '';
    const next = [...assignments, { org_id: orgId, role_id: homeRoleId, lead_assignment_weight: 0 }];
    onChange(next);
    // First branch added is home by definition; there is nothing to choose from.
    if (next.length === 1) onHomeChange(orgId);
    searchInputRef.current?.focus();
  };

  const removeBranch = (orgId: string) => {
    const next = assignments.filter((a) => a.org_id !== orgId);
    onChange(next);
    // Removing the home branch would leave the user with no primary org, so the
    // first remaining branch inherits it rather than leaving the form invalid.
    if (orgId === homeOrgId) onHomeChange(next[0]?.org_id ?? '');
  };

  const patch = (orgId: string, fields: Partial<OrgAssignment>) => {
    onChange(assignments.map((a) => (a.org_id === orgId ? { ...a, ...fields } : a)));
  };

  const multi = assignments.length > 1;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Branch picker ─────────────────────────────────────────── */}
      <div ref={rootRef} className="relative flex flex-col gap-1.5">
        <label className={FIELD_LABEL}>Branches *</label>
        <div
          onClick={() => { if (canPickBranches && !disabled) setOpen(!open); }}
          className={
            'flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-2 py-1.5 shadow-sm ' +
            (canPickBranches && !disabled ? 'cursor-pointer' : 'cursor-not-allowed bg-[#F8FAFC]')
          }
        >
          {assignments.length === 0 && (
            <span className="px-1 text-sm text-[#94A3B8]">Select a branch…</span>
          )}
          {assignments.map((a) => (
            <span
              key={a.org_id}
              title={a.org_id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[12.5px] font-semibold text-[#0b6cbf]"
            >
              {label(a.org_id)}
              {canPickBranches && !disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${label(a.org_id)}`}
                  onClick={(e) => { e.stopPropagation(); removeBranch(a.org_id); }}
                  className="text-[#60A5FA] hover:text-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/30 rounded"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>

        {open && canPickBranches && !disabled && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-lg">
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search branches…"
              className="w-full border-b border-[#F1F5F9] px-3 py-2 text-sm text-[#0F172A] focus:outline-none"
            />
            <div className="max-h-52 overflow-y-auto">
              {available.length === 0 && (
                <p className="px-3 py-2.5 text-sm text-[#94A3B8]">No branches left to add.</p>
              )}
              {available.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => addBranch(b.id)}
                  className="block w-full px-3 py-2 text-left text-sm text-[#0F172A] hover:bg-[#F8FAFC] focus:bg-[#F8FAFC] focus:outline-none"
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!multi && assignments.length === 1 && (
          <p className={HINT}>This is their home branch.</p>
        )}
      </div>

      {/* ── Single branch: role + weight inline, no table ──────────── */}
      {assignments.length === 1 && (
        <SingleBranchRow
          assignment={assignments[0]!}
          roles={selectableRoles}
          status={weightStatus[assignments[0]!.org_id]}
          disabled={disabled}
          onPatch={(f) => patch(assignments[0]!.org_id, f)}
        />
      )}

      {/* ── Multi branch: a row each, with the home radio ──────────── */}
      {multi && (
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Role &amp; weight per branch</label>
          <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
            <div className="grid grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1.5fr)_84px] items-center gap-2.5 border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-[#64748B]">
              <div>Home</div><div>Branch</div><div>Role</div><div>Weight</div>
            </div>

            {assignments.map((a) => {
              const isHome = a.org_id === homeOrgId;
              return (
                <div key={a.org_id} className={isHome ? 'bg-[#F7FBFF]' : ''}>
                  <div className="grid grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1.5fr)_84px] items-center gap-2.5 px-3 py-2">
                    <div>
                      <input
                        type="radio"
                        name="uf-home-branch"
                        checked={isHome}
                        disabled={disabled}
                        onChange={() => onHomeChange(a.org_id)}
                        aria-label={`Make ${label(a.org_id)} the home branch`}
                        className="h-4 w-4 accent-[#0b6cbf] focus:ring-2 focus:ring-[#0b6cbf]/20"
                      />
                    </div>
                    <div title={a.org_id} className="min-w-0 truncate text-[13.5px] font-semibold text-[#0F172A]">
                      {label(a.org_id)}
                      {isHome && (
                        <span className="ml-1.5 rounded border border-[#BFDBFE] bg-[#EFF6FF] px-1 py-px text-[10px] font-bold uppercase tracking-wide text-[#0b6cbf]">
                          Home
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <select
                        value={a.role_id}
                        disabled={disabled}
                        onChange={(e) => patch(a.org_id, { role_id: e.target.value })}
                        aria-label={`Role in ${label(a.org_id)}`}
                        className={`w-full ${FIELD_SM}`}
                      >
                        <option value="">Select a role…</option>
                        {selectableRoles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <WeightInput
                        value={a.lead_assignment_weight}
                        disabled={disabled}
                        label={`Lead assignment weight in ${label(a.org_id)}`}
                        onChange={(v) => patch(a.org_id, { lead_assignment_weight: v })}
                      />
                    </div>
                  </div>
                  <WeightStatusLine status={weightStatus[a.org_id]} inset />
                </div>
              );
            })}

            <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[12px] text-[#475569]">
              Weight is per branch — it splits that branch&apos;s leads, not this person&apos;s time.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SingleBranchRow({
  assignment, roles, status, disabled, onPatch,
}: {
  assignment: OrgAssignment;
  roles: RoleOption[];
  status: WeightStatus | undefined;
  disabled?: boolean | undefined;
  onPatch: (fields: Partial<OrgAssignment>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="uf-branch-role" className={FIELD_LABEL}>Role in this branch</label>
        <select
          id="uf-branch-role"
          value={assignment.role_id}
          disabled={disabled}
          onChange={(e) => onPatch({ role_id: e.target.value })}
          className={`w-full ${FIELD_SM} py-2.5`}
        >
          <option value="">Select a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="uf-branch-weight" className={FIELD_LABEL}>Lead assignment weight</label>
        <WeightInput
          id="uf-branch-weight"
          value={assignment.lead_assignment_weight}
          disabled={disabled}
          label="Lead assignment weight"
          full
          onChange={(v) => onPatch({ lead_assignment_weight: v })}
        />
        <WeightStatusLine status={status} />
      </div>
    </div>
  );
}

function WeightInput({
  value, onChange, disabled, label, id, full,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean | undefined;
  label: string;
  id?: string | undefined;
  full?: boolean | undefined;
}) {
  return (
    <input
      {...(id ? { id } : {})}
      type="number"
      min={0}
      max={100}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => {
        // Clamped on entry rather than on save: the DB CHECK is 0..100, and a
        // rejected save is a worse way to learn that than a field that won't go there.
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? Math.min(100, Math.max(0, Math.trunc(n))) : 0);
      }}
      className={`${full ? 'w-full py-2.5' : 'w-full'} ${FIELD_SM} tabular-nums`}
    />
  );
}

/**
 * A branch's weight health, rendered directly beneath its own row.
 *
 * The healthy case says so out loud. If only problems spoke, a silent row would
 * be ambiguous between "checked and fine" and "not loaded yet" — and the loading
 * state is real here, since each branch is a separate request.
 */
function WeightStatusLine({ status, inset }: { status: WeightStatus | undefined; inset?: boolean }) {
  if (!status || status.status === 'loading') {
    return inset ? <div className="h-px border-b border-[#F1F5F9]" /> : null;
  }

  const pad = inset ? 'px-3 pb-2 pl-[88px]' : '';
  const common = `flex items-baseline gap-1.5 text-[11.5px] leading-snug ${pad}`;
  const border = inset ? 'border-b border-[#F1F5F9]' : '';

  if (status.status === 'ok') {
    return (
      <p className={`${common} ${border} text-[#047857]`}>
        <span aria-hidden className="font-bold">✓</span>
        <span>Branch totals <b className="tabular-nums">100%</b> across {status.userCount} {status.userCount === 1 ? 'user' : 'users'}.</span>
      </p>
    );
  }

  if (status.status === 'zero') {
    return (
      <p className={`${common} ${border} text-[#92400E]`}>
        <span aria-hidden className="font-bold">!</span>
        <span>Branch totals <b className="tabular-nums">0%</b> — new leads here stay unassigned.</span>
      </p>
    );
  }

  return (
    <p className={`${common} ${border} text-[#92400E]`}>
      <span aria-hidden className="font-bold">!</span>
      <span>
        Branch totals <b className="tabular-nums">{status.total}%</b> across {status.userCount}{' '}
        {status.userCount === 1 ? 'user' : 'users'} — auto-assignment expects 100% or 0%.
      </span>
    </p>
  );
}
