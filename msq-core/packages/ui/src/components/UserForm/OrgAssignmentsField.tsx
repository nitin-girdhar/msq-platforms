'use client';

import { useMemo, useState } from 'react';
import { useDropdown } from '../../hooks/useDropdown';
import { rolesForDepartment } from './DepartmentSelect';
import { FIELD_LABEL, FIELD_SM, HINT } from './styles';
import { useWeightStatus, weightStatusKey } from './useWeightStatus';
import type { BranchOption, CampaignTypeOption, OrgAssignment, RoleOption, WeightEntry, WeightStatus } from './types';

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
  /** The tenant's campaign-type catalog — groups weight inputs by type. */
  campaignTypes: CampaignTypeOption[];
  /** True once the catalog fetch has settled and returned nothing usable. */
  campaignTypesUnavailable?: boolean;
}

/**
 * Which campaign-type pools one branch assignment may be weighted for.
 *
 * DEPARTMENT RULE (1.50.2): a weight belongs to the user's department — only
 * campaign types whose department matches the assignment's ROLE department are
 * offered, a role with no department cannot be weighted, and identity-service
 * plus a DB trigger refuse anything else. `mismatched` are weight rows the user
 * already holds that break the rule: kept by decision (routing skips them), shown
 * so an admin can see and remove them.
 */
interface PoolScope {
  state: 'no_role' | 'no_department' | 'ok';
  types: CampaignTypeOption[];
  mismatched: WeightEntry[];
  departmentLabel: string | null;
}

function weightOf(weights: WeightEntry[], campaignTypeId: string): number {
  return weights.find((w) => w.campaign_type_id === campaignTypeId)?.weight ?? 0;
}

function isInPool(weights: WeightEntry[], campaignTypeId: string): boolean {
  return weights.some((w) => w.campaign_type_id === campaignTypeId);
}

function withWeight(weights: WeightEntry[], campaignTypeId: string, weight: number): WeightEntry[] {
  const next = weights.filter((w) => w.campaign_type_id !== campaignTypeId);
  next.push({ campaign_type_id: campaignTypeId, weight });
  return next;
}

function withoutType(weights: WeightEntry[], campaignTypeId: string): WeightEntry[] {
  return weights.filter((w) => w.campaign_type_id !== campaignTypeId);
}

function typeLabel(t: CampaignTypeOption, departmentLabelById: Map<string, string>): string {
  const deptLabel = t.department_id ? departmentLabelById.get(t.department_id) : undefined;
  return deptLabel ? `${t.label} (${deptLabel})` : t.label;
}

/**
 * Which branches a user works in, and — once there is more than one — their role
 * and per-campaign-type lead-assignment weight in each.
 *
 * The single-branch case is deliberately not a one-row table: most users work in
 * one branch and must not pay the multi-branch case's complexity. One branch is
 * silently home, with role and weight(s) inline.
 *
 * Weights are keyed per campaign type (schema 1.49.0) and restricted to the
 * role's department (1.50.2), so each branch offers only its own department's
 * pools.
 */
export default function OrgAssignmentsField({
  branches, assignments, onChange, homeOrgId, onHomeChange,
  roles, departmentId, canPickBranches, disabled, excludeUserId,
  campaignTypes, campaignTypesUnavailable,
}: Props) {
  const { open, setOpen, search, setSearch, rootRef, searchInputRef } = useDropdown();

  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.id, b.name])),
    [branches],
  );

  // Department labels aren't on CampaignTypeOption itself — roles carry
  // department_label, and campaign types share the same department catalog, so
  // resolve through the role list's departments rather than fetching a second
  // catalog just for a label.
  const departmentLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roles) {
      if (r.department_id && r.department_label) m.set(r.department_id, r.department_label);
    }
    return m;
  }, [roles]);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  const poolScopeFor = (a: OrgAssignment): PoolScope => {
    const role = a.role_id ? roleById.get(a.role_id) : undefined;
    if (!role) return { state: 'no_role', types: [], mismatched: [], departmentLabel: null };
    if (!role.department_id) {
      return { state: 'no_department', types: [], mismatched: a.weights, departmentLabel: null };
    }
    const types = campaignTypes.filter((t) => t.department_id === role.department_id);
    const allowed = new Set(types.map((t) => t.id));
    return {
      state: 'ok',
      types,
      mismatched: a.weights.filter((w) => !allowed.has(w.campaign_type_id)),
      departmentLabel: role.department_label ?? departmentLabelById.get(role.department_id) ?? null,
    };
  };

  /**
   * A selected branch's name, or an honest admission that we don't have one.
   *
   * This used to fall back to the raw org_id. A UUID in a chip reads as data —
   * as though the branch were genuinely called that — when it actually means the
   * branch list failed to load or came back without this branch in it. The id
   * stays on the `title` so support can still recover it.
   */
  const label = (orgId: string) => branchName.get(orgId) ?? 'Unknown branch';

  // Every (org, type) pair worth checking status for: the role department's
  // types for each assignment (so a not-yet-added pool can still show an
  // empty-pool hint), plus any type the user already holds a row for.
  const statusPairs = useMemo(() => {
    const seen = new Set<string>();
    const pairs: Array<{ org_id: string; campaign_type_id: string }> = [];
    const add = (orgId: string, typeId: string) => {
      const k = weightStatusKey(orgId, typeId);
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push({ org_id: orgId, campaign_type_id: typeId });
    };
    for (const a of assignments) {
      const role = a.role_id ? roleById.get(a.role_id) : undefined;
      for (const t of campaignTypes) {
        if (role?.department_id && t.department_id === role.department_id) add(a.org_id, t.id);
      }
      for (const w of a.weights) add(a.org_id, w.campaign_type_id);
    }
    return pairs;
  }, [assignments, campaignTypes, roleById]);

  const draftWeights = useMemo(() => {
    const w: Record<string, number> = {};
    for (const a of assignments) {
      for (const entry of a.weights) {
        w[weightStatusKey(a.org_id, entry.campaign_type_id)] = entry.weight;
      }
    }
    return w;
  }, [assignments]);

  const weightStatus = useWeightStatus(statusPairs, draftWeights, excludeUserId);

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
    // default — still just a starting point, fully editable per row. Starts
    // in no pool (weights: []) until explicitly weighted — see
    // useUserAssignments' matching default.
    const homeRoleId = assignments.find((a) => a.org_id === homeOrgId)?.role_id ?? '';
    const next = [...assignments, { org_id: orgId, role_id: homeRoleId, weights: [] }];
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

  const patch = (orgId: string, fields: Partial<Omit<OrgAssignment, 'weights'>>) => {
    onChange(assignments.map((a) => (a.org_id === orgId ? { ...a, ...fields } : a)));
  };

  const patchWeights = (orgId: string, weights: WeightEntry[]) => {
    onChange(assignments.map((a) => (a.org_id === orgId ? { ...a, weights } : a)));
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
        {campaignTypesUnavailable && (
          <p className={HINT}>Campaign types could not be loaded — weights show without a type label.</p>
        )}
      </div>

      {/* ── Single branch: role + weight(s) inline, no table ────────── */}
      {assignments.length === 1 && (
        <SingleBranchRow
          assignment={assignments[0]!}
          roles={selectableRoles}
          pool={poolScopeFor(assignments[0]!)}
          catalog={campaignTypes}
          departmentLabelById={departmentLabelById}
          statusByKey={weightStatus}
          disabled={disabled}
          onPatch={(f) => patch(assignments[0]!.org_id, f)}
          onWeightsChange={(w) => patchWeights(assignments[0]!.org_id, w)}
        />
      )}

      {/* ── Multi branch: a row each, with the home radio ──────────── */}
      {multi && (
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Role &amp; weight per branch</label>
          <div className="overflow-hidden rounded-xl border border-[#E2E8F0]">
            <div className="grid grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1.5fr)] items-center gap-2.5 border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-[#64748B]">
              <div>Home</div><div>Branch</div><div>Role</div>
            </div>

            {assignments.map((a) => {
              const isHome = a.org_id === homeOrgId;
              const pool = poolScopeFor(a);
              return (
                <div key={a.org_id} className={isHome ? 'bg-[#F7FBFF]' : ''}>
                  <div className="grid grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1.5fr)] items-center gap-2.5 px-3 py-2">
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
                  </div>
                  <div className="px-3 pb-2.5 pl-[88px]">
                    <PoolScopeHint pool={pool} />
                    {pool.state === 'ok' && (
                      <BranchWeightsBlock
                        orgId={a.org_id}
                        branchLabel={label(a.org_id)}
                        weights={a.weights}
                        campaignTypes={pool.types}
                        departmentLabel={pool.departmentLabel}
                        departmentLabelById={departmentLabelById}
                        statusByKey={weightStatus}
                        disabled={disabled}
                        onChange={(w) => patchWeights(a.org_id, w)}
                      />
                    )}
                    <MismatchedWeights
                      entries={pool.mismatched}
                      catalog={campaignTypes}
                      departmentLabel={pool.departmentLabel}
                      disabled={disabled}
                      onRemove={(typeId) => patchWeights(a.org_id, withoutType(a.weights, typeId))}
                    />
                  </div>
                </div>
              );
            })}

            <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[12px] text-[#475569]">
              Weight is per branch, per campaign type of the role&apos;s department — it splits that type&apos;s
              leads within the branch, not this person&apos;s time.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Why a branch assignment offers no weight inputs, when it offers none. */
function PoolScopeHint({ pool }: { pool: PoolScope }) {
  if (pool.state === 'no_role') {
    return <p className={HINT}>Select a role to set lead weights — weights follow the role&apos;s department.</p>;
  }
  if (pool.state === 'no_department') {
    return (
      <p className="text-[11px] leading-snug text-[#92400E]">
        This role has no department, so lead weights can&apos;t be set. Assign the role a department first.
      </p>
    );
  }
  if (pool.types.length === 0) {
    return (
      <p className={HINT}>
        No campaign type is set up for the {pool.departmentLabel ?? 'role’s'} department yet — nothing to weight.
      </p>
    );
  }
  return null;
}

/**
 * Weight rows the user already holds OUTSIDE their role's department. Kept by
 * decision (1.50.2) — routing skips them and they cannot be re-pointed — so they
 * are shown read-only with a remove control rather than silently dropped.
 */
function MismatchedWeights({
  entries, catalog, departmentLabel, disabled, onRemove,
}: {
  entries: WeightEntry[];
  catalog: CampaignTypeOption[];
  departmentLabel: string | null;
  disabled?: boolean | undefined;
  onRemove: (campaignTypeId: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 p-2">
      {entries.map((w) => {
        const name = catalog.find((t) => t.id === w.campaign_type_id)?.label ?? 'Unknown campaign type';
        return (
          <div key={w.campaign_type_id} className="flex items-center justify-between gap-2 text-[11.5px] text-[#92400E]">
            <span>
              {name} · {w.weight}% — not in {departmentLabel ? `the ${departmentLabel}` : "this role's"} department, so
              routing skips it.
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(w.campaign_type_id)}
              className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-[#92400E] hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Remove
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SingleBranchRow({
  assignment, roles, pool, catalog, departmentLabelById, statusByKey, disabled, onPatch, onWeightsChange,
}: {
  assignment: OrgAssignment;
  roles: RoleOption[];
  pool: PoolScope;
  catalog: CampaignTypeOption[];
  departmentLabelById: Map<string, string>;
  statusByKey: Record<string, WeightStatus>;
  disabled?: boolean | undefined;
  onPatch: (fields: Partial<Omit<OrgAssignment, 'weights'>>) => void;
  onWeightsChange: (weights: WeightEntry[]) => void;
}) {
  const singleType = pool.state === 'ok' && pool.types.length === 1;
  const onlyType = singleType ? pool.types[0] : undefined;

  return (
    <div className="flex flex-col gap-3">
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
        {onlyType && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="uf-branch-weight" className={FIELD_LABEL}>Lead assignment weight</label>
            <WeightInput
              id="uf-branch-weight"
              value={weightOf(assignment.weights, onlyType.id)}
              disabled={disabled}
              label="Lead assignment weight"
              full
              onChange={(v) => onWeightsChange(withWeight(assignment.weights, onlyType.id, v))}
            />
            <PoolMembership
              inPool={isInPool(assignment.weights, onlyType.id)}
              label={typeLabel(onlyType, departmentLabelById)}
              disabled={disabled}
              onAdd={() => onWeightsChange(withWeight(assignment.weights, onlyType.id, 0))}
              onRemove={() => onWeightsChange(withoutType(assignment.weights, onlyType.id))}
            />
            <WeightStatusLine
              status={statusByKey[weightStatusKey(assignment.org_id, onlyType.id)]}
              typeLabel={typeLabel(onlyType, departmentLabelById)}
            />
          </div>
        )}
      </div>

      <PoolScopeHint pool={pool} />

      {/* Several campaign types in the role's department, one branch: a small
          stacked list rather than the multi-branch table. */}
      {pool.state === 'ok' && pool.types.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Lead assignment weight per campaign type</label>
          <div className="flex flex-col gap-2 rounded-xl border border-[#E2E8F0] p-2.5">
            {pool.types.map((t) => (
              <div key={t.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-[#0F172A]">
                    {typeLabel(t, departmentLabelById)}
                  </span>
                  <WeightInput
                    value={weightOf(assignment.weights, t.id)}
                    disabled={disabled}
                    label={`Lead assignment weight for ${typeLabel(t, departmentLabelById)}`}
                    onChange={(v) => onWeightsChange(withWeight(assignment.weights, t.id, v))}
                  />
                </div>
                <PoolMembership
                  inPool={isInPool(assignment.weights, t.id)}
                  label={typeLabel(t, departmentLabelById)}
                  disabled={disabled}
                  onAdd={() => onWeightsChange(withWeight(assignment.weights, t.id, 0))}
                  onRemove={() => onWeightsChange(withoutType(assignment.weights, t.id))}
                />
                <WeightStatusLine
                  status={statusByKey[weightStatusKey(assignment.org_id, t.id)]}
                  typeLabel={typeLabel(t, departmentLabelById)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <MismatchedWeights
        entries={pool.mismatched}
        catalog={catalog}
        departmentLabel={pool.departmentLabel}
        disabled={disabled}
        onRemove={(typeId) => onWeightsChange(withoutType(assignment.weights, typeId))}
      />
    </div>
  );
}

/**
 * A multi-branch row's per-campaign-type weights, for the role department's
 * types only.
 *
 * Closed by default (a summary line only), so a branch with several types does
 * not dominate the table. Every offered type appears once opened — either as a
 * live weight row (present in `weights`) or as an explicit "not in this pool"
 * affordance — never silently missing. Zero-weight types collapse behind their
 * own secondary disclosure once there is at least one non-zero type to show by
 * default.
 */
function BranchWeightsBlock({
  orgId, branchLabel, weights, campaignTypes, departmentLabel, departmentLabelById, statusByKey, disabled, onChange,
}: {
  orgId: string;
  branchLabel: string;
  weights: WeightEntry[];
  campaignTypes: CampaignTypeOption[];
  departmentLabel: string | null;
  departmentLabelById: Map<string, string>;
  statusByKey: Record<string, WeightStatus>;
  disabled?: boolean | undefined;
  onChange: (next: WeightEntry[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showZero, setShowZero] = useState(false);

  if (campaignTypes.length === 0) return null;

  // Counted over the department's types only; out-of-department rows are listed
  // separately by MismatchedWeights.
  const offered = new Set(campaignTypes.map((t) => t.id));
  const inDepartment = weights.filter((w) => offered.has(w.campaign_type_id));
  const inPoolCount = inDepartment.length;
  const zeroCount = inDepartment.filter((w) => w.weight === 0).length;

  const nonZeroTypes = campaignTypes.filter((t) => isInPool(weights, t.id) && weightOf(weights, t.id) > 0);
  const zeroTypes = campaignTypes.filter((t) => isInPool(weights, t.id) && weightOf(weights, t.id) === 0);
  const notInPoolTypes = campaignTypes.filter((t) => !isInPool(weights, t.id));

  // Pools in this branch that will route NOTHING: nobody weighted, or everyone
  // at 0%. Surfaced on the collapsed summary line, not only inside the
  // disclosure — the block is closed by default, and a hint nobody opens is how
  // "10 of 30 branches had no weighted user" went unnoticed.
  const emptyPoolLabels = campaignTypes
    .filter((t) => {
      const s = statusByKey[weightStatusKey(orgId, t.id)];
      return !!s && s.status !== 'loading' && (s.userCount === 0 || s.status === 'zero');
    })
    .map((t) => typeLabel(t, departmentLabelById));

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-left text-[11.5px] font-semibold text-[#0b6cbf] hover:underline focus:outline-none"
        aria-expanded={open}
        aria-label={`Campaign-type weights in ${branchLabel}`}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        {inPoolCount === 0
          ? `Not in any ${departmentLabel ?? ''} pool yet`.replace('  ', ' ')
          : `${inPoolCount} type${inPoolCount === 1 ? '' : 's'}${zeroCount > 0 ? `, ${zeroCount} at 0%` : ''}`}
      </button>

      {!open && emptyPoolLabels.length > 0 && (
        <p className="flex items-baseline gap-1.5 text-[11px] leading-snug text-[#92400E]">
          <span aria-hidden className="font-bold">!</span>
          <span>
            {emptyPoolLabels.join(', ')} {emptyPoolLabels.length === 1 ? 'has' : 'have'} no active weight in this
            branch — new leads of that type stay unassigned.
          </span>
        </p>
      )}

      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#E2E8F0] bg-white p-2.5">
          {nonZeroTypes.map((t) => (
            <TypeWeightRow
              key={t.id}
              type={t}
              departmentLabelById={departmentLabelById}
              status={statusByKey[weightStatusKey(orgId, t.id)]}
              disabled={disabled}
              value={weightOf(weights, t.id)}
              onChange={(v) => onChange(withWeight(weights, t.id, v))}
              onRemove={() => onChange(withoutType(weights, t.id))}
            />
          ))}

          {zeroTypes.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowZero(!showZero)}
                className="text-left text-[11px] font-semibold text-[#64748B] hover:underline focus:outline-none"
              >
                {showZero ? 'Hide' : 'Show'} {zeroTypes.length} type{zeroTypes.length === 1 ? '' : 's'} at 0%
              </button>
              {showZero && zeroTypes.map((t) => (
                <TypeWeightRow
                  key={t.id}
                  type={t}
                  departmentLabelById={departmentLabelById}
                  status={statusByKey[weightStatusKey(orgId, t.id)]}
                  disabled={disabled}
                  value={weightOf(weights, t.id)}
                  onChange={(v) => onChange(withWeight(weights, t.id, v))}
                  onRemove={() => onChange(withoutType(weights, t.id))}
                />
              ))}
            </div>
          )}

          {notInPoolTypes.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-[#F1F5F9] pt-2">
              {notInPoolTypes.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-[11.5px] text-[#94A3B8]">
                  <span>{typeLabel(t, departmentLabelById)} — not in this pool</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(withWeight(weights, t.id, 0))}
                    className="rounded border border-[#E2E8F0] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0b6cbf] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Add to pool
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TypeWeightRow({
  type, departmentLabelById, status, disabled, value, onChange, onRemove,
}: {
  type: CampaignTypeOption;
  departmentLabelById: Map<string, string>;
  status: WeightStatus | undefined;
  disabled?: boolean | undefined;
  value: number;
  onChange: (v: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-[#0F172A]">
          {typeLabel(type, departmentLabelById)}
        </span>
        <div className="flex items-center gap-1.5">
          <WeightInput
            value={value}
            disabled={disabled}
            label={`Lead assignment weight for ${typeLabel(type, departmentLabelById)}`}
            onChange={onChange}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove from ${typeLabel(type, departmentLabelById)} pool`}
            className="text-[#94A3B8] hover:text-red-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            ✕
          </button>
        </div>
      </div>
      <WeightStatusLine status={status} typeLabel={typeLabel(type, departmentLabelById)} />
    </div>
  );
}

/**
 * Pool membership, beside a single-branch weight input.
 *
 * "Not in this pool" and "in the pool at 0%" used to render identically — an
 * input showing 0 — but they are different states: no row means the person is
 * not in that type's rotation at all; a 0 row keeps them listed in the pool and
 * out of rotation. The single input stays (the common case must remain one
 * obvious field); this line says which of the two a 0 means and offers the
 * explicit transition.
 */
function PoolMembership({
  inPool, label, disabled, onAdd, onRemove,
}: {
  inPool: boolean;
  label: string;
  disabled?: boolean | undefined;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const link = 'font-semibold hover:underline focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
  return inPool ? (
    <p className="text-[11px] text-[#64748B]">
      In the {label} pool.{' '}
      <button type="button" disabled={disabled} onClick={onRemove} className={`${link} text-[#64748B] hover:text-red-600`}>
        Remove from pool
      </button>
    </p>
  ) : (
    <p className="text-[11px] text-[#94A3B8]">
      Not in the {label} pool — enter a weight, or{' '}
      <button type="button" disabled={disabled} onClick={onAdd} className={`${link} text-[#0b6cbf]`}>
        add at 0%
      </button>
      .
    </p>
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
      className={`${full ? 'w-full py-2.5' : 'w-20'} ${FIELD_SM} tabular-nums`}
    />
  );
}

/**
 * A pool's weight health, rendered directly beneath its own row.
 *
 * The healthy case says so out loud. If only problems spoke, a silent row would
 * be ambiguous between "checked and fine" and "not loaded yet" — and the loading
 * state is real here, since each pool is a separate request. `userCount === 0`
 * is the empty-pool hint: nobody weighted for this type in this branch yet,
 * distinct from "totals 0% across N people".
 */
function WeightStatusLine({ status, typeLabel: label }: { status: WeightStatus | undefined; typeLabel?: string }) {
  if (!status || status.status === 'loading') return null;

  const common = 'flex items-baseline gap-1.5 text-[11px] leading-snug';

  if (status.userCount === 0) {
    return (
      <p className={`${common} text-[#64748B]`}>
        <span aria-hidden>·</span>
        <span>No one is weighted for {label ?? 'this type'} in this branch.</span>
      </p>
    );
  }

  if (status.status === 'ok') {
    return (
      <p className={`${common} text-[#047857]`}>
        <span aria-hidden className="font-bold">✓</span>
        <span>Pool totals <b className="tabular-nums">100%</b> across {status.userCount} {status.userCount === 1 ? 'user' : 'users'}.</span>
      </p>
    );
  }

  if (status.status === 'zero') {
    return (
      <p className={`${common} text-[#92400E]`}>
        <span aria-hidden className="font-bold">!</span>
        <span>Pool totals <b className="tabular-nums">0%</b> — new leads here stay unassigned.</span>
      </p>
    );
  }

  return (
    <p className={`${common} text-[#92400E]`}>
      <span aria-hidden className="font-bold">!</span>
      <span>
        Pool totals <b className="tabular-nums">{status.total}%</b> across {status.userCount}{' '}
        {status.userCount === 1 ? 'user' : 'users'} — auto-assignment expects 100% or 0%.
      </span>
    </p>
  );
}
