'use client';

import { useEffect, useMemo, useState } from 'react';
import { lookupAdmin, orgs as orgsApi, users as usersApi, type OrgMappingRow } from '@/src/lib/api/client';

interface Props {
  userId: string;
}

interface OrgOption {
  id: string;
  name: string;
  tenant_id: string;
}

interface RoleOption {
  id: string;
  name: string;
  label: string;
  rank: number;
}

interface RowState {
  roleId: string;
  weight: string;
  pending: boolean;
  error: string | null;
}

export default function OrgAccessPanel({ userId }: Props) {
  const [mappings, setMappings] = useState<OrgMappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  const loadMappings = () => {
    setLoading(true);
    setLoadError(null);
    return usersApi.orgMappings.list(userId)
      .then((res) => setMappings(res.data))
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load org access.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMappings();
    orgsApi.listAll()
      .then((res) => setOrgOptions(res.data.map((o) => ({ id: o.id, name: o.name, tenant_id: o.tenant_id }))))
      .catch(() => setOrgOptions([]));
    lookupAdmin.list('user-roles')
      .then((res) => {
        const rows = res.data as unknown as Array<{ id: string; name: string; label: string; is_active: boolean; rank: number }>;
        const active = rows
          .filter((r) => r.is_active)
          .sort((a, b) => a.rank - b.rank)
          .map((r) => ({ id: r.id, name: r.name, label: r.label, rank: r.rank }));
        setRoleOptions(active);
      })
      .catch(() => setRoleOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Map org_id -> active mapping, for O(1) lookups while rendering the checklist.
  const mappingByOrgId = useMemo(() => {
    const map = new Map<string, OrgMappingRow>();
    for (const m of mappings) map.set(m.org_id, m);
    return map;
  }, [mappings]);

  const defaultRoleId = roleOptions[0]?.id ?? '';

  // Seed/refresh per-row role selection from the current mappings once both
  // orgs and mappings/roles are known — never clobber a role the user is
  // actively editing (a row already present in state keeps its selection).
  useEffect(() => {
    if (orgOptions.length === 0) return;
    setRowState((prev) => {
      const next = { ...prev };
      for (const org of orgOptions) {
        if (next[org.id]) continue;
        const mapping = mappingByOrgId.get(org.id);
        const roleId = mapping
          ? (roleOptions.find((r) => r.name === mapping.role_name)?.id ?? defaultRoleId)
          : defaultRoleId;
        next[org.id] = { roleId, weight: '', pending: false, error: null };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgOptions, mappingByOrgId, roleOptions, defaultRoleId]);

  const setRow = (orgId: string, patch: Partial<RowState>) => {
    setRowState((prev) => ({ ...prev, [orgId]: { ...prev[orgId], ...patch } as RowState }));
  };

  const grant = async (orgId: string, roleId: string, weight: string) => {
    if (!roleId) {
      setRow(orgId, { error: 'Select a role.' });
      return;
    }
    setRow(orgId, { pending: true, error: null });
    try {
      const body: Record<string, unknown> = { org_id: orgId, role_id: roleId };
      if (weight !== '') body.lead_assignment_weight = Number(weight);
      await usersApi.orgMappings.add(userId, body);
      await loadMappings();
    } catch (err) {
      setRow(orgId, { error: err instanceof Error ? err.message : 'Network error.' });
    } finally {
      setRow(orgId, { pending: false });
    }
  };

  const revoke = async (orgId: string) => {
    setRow(orgId, { pending: true, error: null });
    try {
      await usersApi.orgMappings.remove(userId, orgId);
      await loadMappings();
    } catch (err) {
      setRow(orgId, { error: err instanceof Error ? err.message : 'Network error.' });
    } finally {
      setRow(orgId, { pending: false });
    }
  };

  const handleToggle = (orgId: string, checked: boolean) => {
    const row = rowState[orgId];
    if (!row) return;
    if (checked) {
      grant(orgId, row.roleId || defaultRoleId, row.weight);
    } else {
      revoke(orgId);
    }
  };

  const handleRoleChange = (orgId: string, roleId: string) => {
    setRow(orgId, { roleId });
    const mapping = mappingByOrgId.get(orgId);
    if (mapping) {
      // Already granted — changing the role immediately upserts the mapping.
      grant(orgId, roleId, rowState[orgId]?.weight ?? '');
    }
  };

  const handleWeightChange = (orgId: string, weight: string) => {
    setRow(orgId, { weight });
  };

  const handleWeightCommit = (orgId: string) => {
    const mapping = mappingByOrgId.get(orgId);
    const row = rowState[orgId];
    if (!mapping || !row) return;
    grant(orgId, row.roleId || defaultRoleId, row.weight);
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-[#0F172A]">Organization Access</h3>

      {loadError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {loadError}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-[#64748B]">Loading…</p>
      ) : orgOptions.length === 0 ? (
        <p className="text-xs text-[#64748B]">No organizations found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orgOptions.map((org) => {
            const mapping = mappingByOrgId.get(org.id);
            const checked = !!mapping;
            const row = rowState[org.id] ?? { roleId: defaultRoleId, weight: '', pending: false, error: null };

            return (
              <li key={org.id} className="rounded-xl border border-[#E2E8F0] px-3 py-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`oap-check-${org.id}`}
                    checked={checked}
                    disabled={row.pending || roleOptions.length === 0}
                    onChange={(e) => handleToggle(org.id, e.target.checked)}
                    className="h-4 w-4 shrink-0 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed"
                  />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`oap-check-${org.id}`} className="block truncate text-sm font-semibold text-[#0F172A]">
                      {org.name}
                    </label>
                    <p className="truncate text-[11px] text-[#64748B]">
                      {mapping?.tenant_name ?? org.tenant_id}
                      {checked && mapping?.granted_at ? ` · granted ${new Date(mapping.granted_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <select
                    aria-label={`Role for ${org.name}`}
                    value={row.roleId}
                    disabled={!checked || row.pending}
                    onChange={(e) => handleRoleChange(org.id, e.target.value)}
                    className="shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]"
                  >
                    {roleOptions.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                  <input
                    aria-label={`Lead weight for ${org.name}`}
                    type="number"
                    min={0}
                    max={100}
                    placeholder="Wt."
                    value={row.weight}
                    disabled={!checked || row.pending}
                    onChange={(e) => handleWeightChange(org.id, e.target.value)}
                    onBlur={() => handleWeightCommit(org.id)}
                    className="w-16 shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]"
                  />
                  {row.pending && (
                    <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
                  )}
                </div>
                {row.error && (
                  <p role="alert" className="mt-1.5 pl-7 text-[11px] text-red-700">{row.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
