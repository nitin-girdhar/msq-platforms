'use client';

import { useEffect, useMemo, useState } from 'react';
import { lookupAdmin, orgs as orgsApi, users as usersApi, campaignTypes as campaignTypesApi, type OrgMappingRow, type CampaignTypeRow } from '@/src/lib/api/client';

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
  // Lead-assignment weights follow the role's department (1.50.2): only that
  // department's campaign types are offered, and a role with none can't be
  // weighted.
  department_id: string | null;
}

interface RowState {
  roleId: string;
  // Per-campaign-type weight inputs (schema 1.49.0) — one org mapping now
  // carries an independent weight per type, keyed by campaign_type_id.
  weights: Record<string, string>;
  pending: boolean;
  error: string | null;
}

export default function OrgAccessPanel({ userId }: Props) {
  const [mappings, setMappings] = useState<OrgMappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  // Roles are tenant-owned (_migrations/23), and this panel spans every tenant's
  // orgs — so one flat role list cannot serve it. Keyed by tenant, and each org
  // row offers only the roles its own tenant owns.
  const [rolesByTenant, setRolesByTenant] = useState<Record<string, RoleOption[]>>({});
  // Per-tenant campaign-type catalog, for the weight rows nested under each
  // granted org. Fetched per tenant with ?tenant_id=, which leads-service
  // honours for a platform super_admin, so each org row is offered ITS OWN
  // tenant's types. identity-service re-checks the pairing on write (the type
  // must belong to the org's tenant) and a DB trigger on
  // lms.lead_assignment_weights refuses a mismatch outright.
  // campaignTypesLoadedTenants below still distinguishes "not loaded / failed"
  // from "this tenant has no types".
  const [campaignTypesByTenant, setCampaignTypesByTenant] = useState<Record<string, CampaignTypeRow[]>>({});
  const [campaignTypesLoadedTenants, setCampaignTypesLoadedTenants] = useState<Set<string>>(new Set());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // One role fetch per tenant represented in the org list.
  useEffect(() => {
    const tenantIds = [...new Set(orgOptions.map((o) => o.tenant_id))];
    if (tenantIds.length === 0) return;
    let cancelled = false;

    Promise.all(
      tenantIds.map((tenantId) =>
        lookupAdmin.list('user-roles', tenantId)
          .then((res) => {
            const rows = res.data as unknown as Array<{ id: string; name: string; label: string; is_active: boolean; rank: number; department_id: string | null }>;
            const active = rows
              .filter((r) => r.is_active)
              .sort((a, b) => a.rank - b.rank)
              .map((r) => ({ id: r.id, name: r.name, label: r.label, rank: r.rank, department_id: r.department_id ?? null }));
            return [tenantId, active] as const;
          })
          .catch(() => [tenantId, [] as RoleOption[]] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setRolesByTenant(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [orgOptions]);

  // One campaign-type fetch per tenant represented in the org list — mirrors
  // the rolesByTenant effect above exactly.
  useEffect(() => {
    const tenantIds = [...new Set(orgOptions.map((o) => o.tenant_id))];
    if (tenantIds.length === 0) return;
    let cancelled = false;

    Promise.all(
      tenantIds.map((tenantId) =>
        campaignTypesApi.list(tenantId)
          .then((res) => [tenantId, res.data.filter((t) => t.is_active)] as const)
          .catch(() => [tenantId, [] as CampaignTypeRow[]] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setCampaignTypesByTenant(Object.fromEntries(entries));
      setCampaignTypesLoadedTenants(new Set(entries.map(([tenantId]) => tenantId)));
    });

    return () => {
      cancelled = true;
    };
  }, [orgOptions]);

  // Map org_id -> active mapping, for O(1) lookups while rendering the checklist.
  const mappingByOrgId = useMemo(() => {
    const map = new Map<string, OrgMappingRow>();
    for (const m of mappings) map.set(m.org_id, m);
    return map;
  }, [mappings]);

  // The lowest-ranked role of the org's OWN tenant — the safe default to grant.
  const defaultRoleFor = (tenantId: string) => rolesByTenant[tenantId]?.[0]?.id ?? '';
  const roleIn = (tenantId: string, roleId: string) =>
    (rolesByTenant[tenantId] ?? []).find((r) => r.id === roleId);

  // The campaign types a role may be weighted for: its own department's
  // (1.50.2). Empty for a role with no department — such a role cannot be
  // weighted, and identity-service / the DB refuse it.
  const typesForRole = (tenantId: string, roleId: string) => {
    const dept = roleIn(tenantId, roleId)?.department_id;
    if (!dept) return [];
    return (campaignTypesByTenant[tenantId] ?? []).filter((t) => t.department_id === dept);
  };

  // The pool to grant into when a row is first checked: the ROLE DEPARTMENT's
  // type (its default if it has several), no longer the tenant-wide default —
  // which would have put an HR role in the Sales pool.
  const defaultTypeFor = (tenantId: string, roleId: string) => {
    const types = typesForRole(tenantId, roleId);
    return types.find((t) => t.is_default)?.id ?? types[0]?.id ?? '';
  };

  // Seed/refresh per-row role selection and weight inputs from the current
  // mappings once orgs/mappings/roles are known — never clobber a row the user
  // is actively editing (a row already present in state keeps its selection).
  useEffect(() => {
    if (orgOptions.length === 0) return;
    setRowState((prev) => {
      const next = { ...prev };
      for (const org of orgOptions) {
        if (next[org.id]) continue;
        const mapping = mappingByOrgId.get(org.id);
        const tenantRoles = rolesByTenant[org.tenant_id] ?? [];
        const fallback = defaultRoleFor(org.tenant_id);
        const roleId = mapping
          ? (tenantRoles.find((r) => r.name === mapping.role_name)?.id ?? fallback)
          : fallback;
        const weights: Record<string, string> = {};
        for (const w of mapping?.weights ?? []) weights[w.campaign_type_id] = String(w.weight);
        next[org.id] = { roleId, weights, pending: false, error: null };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgOptions, mappingByOrgId, rolesByTenant]);

  const setRow = (orgId: string, patch: Partial<RowState>) => {
    setRowState((prev) => ({ ...prev, [orgId]: { ...prev[orgId], ...patch } as RowState }));
  };

  const grant = async (orgId: string, roleId: string, campaignTypeId: string, weight: string) => {
    if (!roleId) {
      setRow(orgId, { error: 'Select a role.' });
      return;
    }
    if (!campaignTypeId) {
      setRow(orgId, {
        error: 'This role has no department, or its department has no campaign type — lead weights follow the role’s department.',
      });
      return;
    }
    setRow(orgId, { pending: true, error: null });
    try {
      const body: Record<string, unknown> = { org_id: orgId, role_id: roleId, campaign_type_id: campaignTypeId };
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
      const org = orgOptions.find((o) => o.id === orgId);
      const roleId = row.roleId || (org ? defaultRoleFor(org.tenant_id) : '');
      const typeId = org ? defaultTypeFor(org.tenant_id, roleId) : '';
      grant(orgId, roleId, typeId, typeId ? (row.weights[typeId] ?? '') : '');
    } else {
      revoke(orgId);
    }
  };

  const handleRoleChange = (orgId: string, roleId: string) => {
    setRow(orgId, { roleId });
    const mapping = mappingByOrgId.get(orgId);
    if (mapping) {
      // Already granted — changing the role immediately upserts the mapping,
      // against whichever type already has a row (or the tenant default).
      const org = orgOptions.find((o) => o.id === orgId);
      // A type the user already holds IN THE NEW ROLE'S DEPARTMENT, else that
      // department's default — never a leftover row from the old department.
      const allowed = new Set(org ? typesForRole(org.tenant_id, roleId).map((t) => t.id) : []);
      const typeId = mapping.weights.find((w) => allowed.has(w.campaign_type_id))?.campaign_type_id
        ?? (org ? defaultTypeFor(org.tenant_id, roleId) : '');
      grant(orgId, roleId, typeId, typeId ? (rowState[orgId]?.weights[typeId] ?? '') : '');
    }
  };

  const handleWeightChange = (orgId: string, campaignTypeId: string, weight: string) => {
    setRowState((prev) => {
      const row = prev[orgId];
      if (!row) return prev;
      return { ...prev, [orgId]: { ...row, weights: { ...row.weights, [campaignTypeId]: weight } } };
    });
  };

  const handleWeightCommit = (orgId: string, campaignTypeId: string) => {
    const mapping = mappingByOrgId.get(orgId);
    const row = rowState[orgId];
    if (!mapping || !row) return;
    grant(orgId, row.roleId, campaignTypeId, row.weights[campaignTypeId] ?? '');
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
            // Only this org's own tenant's roles are assignable to it.
            const orgRoles = rolesByTenant[org.tenant_id] ?? [];
            const typesLoaded = campaignTypesLoadedTenants.has(org.tenant_id);
            const typesUnavailable = typesLoaded && (campaignTypesByTenant[org.tenant_id] ?? []).length === 0;
            const row = rowState[org.id]
              ?? { roleId: defaultRoleFor(org.tenant_id), weights: {}, pending: false, error: null };
            // Only the selected role's department's pools (1.50.2).
            const orgTypes = typesForRole(org.tenant_id, row.roleId);
            const roleHasDepartment = !!roleIn(org.tenant_id, row.roleId)?.department_id;
            const allowedTypeIds = new Set(orgTypes.map((t) => t.id));
            // Rows already held outside that department: kept, skipped by routing.
            const mismatchedWeights = (mapping?.weights ?? []).filter((w) => !allowedTypeIds.has(w.campaign_type_id));

            return (
              <li key={org.id} className="rounded-xl border border-[#E2E8F0] px-3 py-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`oap-check-${org.id}`}
                    checked={checked}
                    disabled={row.pending || orgRoles.length === 0 || (!checked && typesUnavailable)}
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
                    {orgRoles.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                  {row.pending && (
                    <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#0b6cbf]/30 border-t-[#0b6cbf]" aria-hidden />
                  )}
                </div>

                {/* Per-campaign-type weight rows (schema 1.49.0) — shown once
                    this org is granted, one weight input per tenant type. */}
                {checked && !typesUnavailable && (
                  <ul className="mt-2 flex flex-col gap-1 pl-7">
                    {orgTypes.map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#475569]">{t.label}</span>
                        <input
                          aria-label={`Lead weight for ${t.label} in ${org.name}`}
                          type="number"
                          min={0}
                          max={100}
                          placeholder="Wt."
                          value={row.weights[t.id] ?? ''}
                          disabled={row.pending}
                          onChange={(e) => handleWeightChange(org.id, t.id, e.target.value)}
                          onBlur={() => handleWeightCommit(org.id, t.id)}
                          className="w-16 shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1 text-xs text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]"
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {typesUnavailable && (
                  <p className="mt-1.5 pl-7 text-[11px] text-amber-700">
                    Campaign types unavailable for this branch&apos;s tenant — lead-assignment weight
                    cannot be set here right now.
                  </p>
                )}

                {checked && !typesUnavailable && !roleHasDepartment && (
                  <p className="mt-1.5 pl-7 text-[11px] text-amber-700">
                    This role has no department, so lead weights can&apos;t be set. Assign the role a department in
                    User Roles first.
                  </p>
                )}

                {checked && !typesUnavailable && roleHasDepartment && orgTypes.length === 0 && (
                  <p className="mt-1.5 pl-7 text-[11px] text-[#64748B]">
                    No campaign type is set up for this role&apos;s department yet — nothing to weight.
                  </p>
                )}

                {mismatchedWeights.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5 pl-7">
                    {mismatchedWeights.map((w) => (
                      <li key={w.campaign_type_id} className="text-[11px] text-amber-700">
                        {w.campaign_type_label} · {w.weight}% — outside this role&apos;s department, so routing skips
                        it. Remove it from the user&apos;s edit form.
                      </li>
                    ))}
                  </ul>
                )}

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
