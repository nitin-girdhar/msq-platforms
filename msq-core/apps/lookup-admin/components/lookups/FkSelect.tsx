'use client';

import { useEffect, useState } from 'react';
import { lookupAdmin, departmentsApi, orgs } from '@/src/lib/api/client';
import type { LookupFieldConfig, FormValues } from '@/src/lib/lookupTableConfig';

interface OptionRow {
  id: string;
  label: string;
}

interface RawLookupRow {
  id: string | number;
  name?: string;
  label?: string;
  is_active?: boolean;
  [key: string]: unknown;
}

interface Props {
  field: LookupFieldConfig;
  value: string;
  onChange: (value: string) => void;
  formValues: FormValues;
  tenantId?: string | undefined;
  orgId?: string | undefined;
  disabled?: boolean;
  idPrefix: string;
  /** Label of the field this one `dependsOn`, for the "select X first" hint. */
  dependsOnLabel?: string | undefined;
  /** Explanatory note under the control, e.g. why it is locked. */
  hint?: string | undefined;
}

async function fetchOptions(field: LookupFieldConfig, formValues: FormValues, tenantId?: string, orgId?: string): Promise<OptionRow[]> {
  const fk = field.fk;
  if (!fk) return [];

  // geo.* is a tenant catalog, so its options need a tenant. On the
  // organizations form that is the form's own tenant_id field (a super_admin
  // is editing some other tenant's branch); elsewhere it is the tenant
  // selected in the navbar. Without one there is nothing to offer.
  if (fk.endpoint === 'geo-countries' || fk.endpoint === 'geo-states' || fk.endpoint === 'geo-cities') {
    const geoTenantId = String(formValues['tenant_id'] ?? tenantId ?? '');
    if (!geoTenantId) return [];

    // Deactivated places stay in the table so existing branches keep
    // resolving, but must never be offered as a new choice.
    const active = <T extends { is_active?: boolean }>(rows: T[]) => rows.filter((r) => r.is_active !== false);

    if (fk.endpoint === 'geo-countries') {
      const res = await lookupAdmin.geo.countries(geoTenantId);
      return active(res.data).map((c) => ({ id: c.id, label: c.name }));
    }
    // The parent filter only applies when the field declares a dependsOn.
    // Without one (the Cities admin page picks a state directly) the whole
    // tenant's list is offered.
    if (fk.endpoint === 'geo-states') {
      const countryId = fk.dependsOn ? String(formValues[fk.dependsOn] ?? '') : '';
      if (fk.dependsOn && !countryId) return [];
      const res = await lookupAdmin.geo.states(geoTenantId);
      return active(res.data)
        .filter((s) => !countryId || s.country_id === countryId)
        .map((s) => ({ id: s.id, label: s.name }));
    }
    const stateId = fk.dependsOn ? String(formValues[fk.dependsOn] ?? '') : '';
    if (fk.dependsOn && !stateId) return [];
    const res = await lookupAdmin.geo.cities(geoTenantId);
    return active(res.data)
      .filter((c) => !stateId || c.state_id === stateId)
      .map((c) => ({ id: c.id, label: c.name }));
  }
  // Departments are not a /lookups/{table} catalog — they live on their own
  // tenant-scoped route, so they cannot go through the fk.table branch below.
  if (fk.endpoint === 'departments') {
    if (!tenantId) return [];
    const res = await departmentsApi.list(tenantId);
    return res.data.map((d) => ({ id: String(d.id), label: d.name }));
  }
  // Orgs come from the cross-tenant /lookups/organizations route, so the tenant
  // filter is applied here. Used by departments.org_id, where leaving it blank
  // means "tenant-wide". NOT identity-service's /orgs/all — that route projects
  // no tenant_id (so this filter matched nothing and the list was always empty)
  // and is pinned to the CALLER's tenant. See orgs.listAll in src/lib/api/client.ts.
  if (fk.endpoint === 'orgs') {
    if (!tenantId) return [];
    const res = await orgs.listAll();
    return res.data
      .filter((o) => o.tenant_id === tenantId)
      .map((o) => ({ id: String(o.id), label: o.name }));
  }
  if (fk.table) {
    if (fk.dependsOn && !formValues[fk.dependsOn]) return [];
    // Global parents (org-types, tenant-domains, …) never take a tenant_id;
    // tenant-scoped parents (lead-stage, …) require the child's own tenant;
    // org-scoped parents (holiday-calendars, …) require BOTH — the RLS
    // session is pinned from tenant_id, the row filter is org_id.
    // Getting this wrong for a global parent 400s the request server-side.
    const scopedTenantId = fk.scope === 'global' ? undefined : tenantId;
    const scopedOrgId = fk.scope === 'org' ? orgId : undefined;
    if (fk.scope === 'org' && !scopedOrgId) return [];
    const res = await lookupAdmin.list(fk.table, scopedTenantId, scopedOrgId);
    const rows = res.data as unknown as RawLookupRow[];
    return rows
      .filter((r) => r.is_active !== false)
      .map((r) => ({
        id: String(r.id),
        label: fk.labelFrom ? fk.labelFrom(r) : r.label ? `${r.label} (${r.name})` : String(r.name ?? r.id),
      }));
  }
  return [];
}

// Generic FK dropdown: resolves its option list from `field.fk`, chains off a
// sibling field via `dependsOn` (clearing + disabling until the parent has a
// value), and refetches whenever that parent value changes. Replaces both the
// old ad-hoc `selectOptionsFrom` fetch (duplicated in Create/EditLookupModal)
// and the hardcoded GeoCascadeSelect triple — country/state/city are now just
// three fields with dependsOn chaining like any other FK.
export default function FkSelect({ field, value, onChange, formValues, tenantId, orgId, disabled, idPrefix, dependsOnLabel, hint }: Props) {
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fk = field.fk;
  const depValue = fk?.dependsOn ? formValues[fk.dependsOn] : undefined;
  const parentPending = Boolean(fk?.dependsOn) && !depValue;

  useEffect(() => {
    if (!fk) return;
    if (parentPending) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchOptions(field, formValues, tenantId, orgId)
      .then((rows) => {
        if (!cancelled) setOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Refetch only on what actually changes the result set: the field's own fk
    // config, the parent value it chains off, and the tenant/org scope.
    // `formValues` is otherwise excluded — every keystroke elsewhere would
    // refetch options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fk?.table, fk?.endpoint, depValue, tenantId, orgId, parentPending]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${idPrefix}-${field.key}`} className="text-xs font-semibold text-[#0F172A]">
        {field.label}{field.required ? ' *' : ''}
      </label>
      <select
        id={`${idPrefix}-${field.key}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || parentPending || loading}
        required={field.required}
        className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
      >
        <option value="">
          {parentPending
            ? `Select ${dependsOnLabel ?? 'the parent field'} first`
            : `— Select ${field.label} —`}
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
      {hint && !error && <p className="text-[11px] text-[#94A3B8]">{hint}</p>}
      {error && <p className="text-[11px] text-red-600">Couldn&apos;t load options — try again.</p>}
    </div>
  );
}
