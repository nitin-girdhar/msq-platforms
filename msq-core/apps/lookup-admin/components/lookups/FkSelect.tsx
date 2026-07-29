'use client';

import { useEffect, useState } from 'react';
import { lookupAdmin } from '@/src/lib/api/client';
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
  disabled?: boolean;
  idPrefix: string;
  /** Label of the field this one `dependsOn`, for the "select X first" hint. */
  dependsOnLabel?: string | undefined;
}

async function fetchOptions(field: LookupFieldConfig, formValues: FormValues, tenantId?: string): Promise<OptionRow[]> {
  const fk = field.fk;
  if (!fk) return [];

  if (fk.endpoint === 'geo-countries') {
    const res = await lookupAdmin.geo.countries();
    return res.data.map((c) => ({ id: String(c.id), label: c.name }));
  }
  if (fk.endpoint === 'geo-states') {
    const countryId = fk.dependsOn ? String(formValues[fk.dependsOn] ?? '') : '';
    if (!countryId) return [];
    const res = await lookupAdmin.geo.states(countryId);
    return res.data.map((s) => ({ id: String(s.id), label: s.name }));
  }
  if (fk.endpoint === 'geo-cities') {
    const stateId = fk.dependsOn ? String(formValues[fk.dependsOn] ?? '') : '';
    if (!stateId) return [];
    const res = await lookupAdmin.geo.cities(stateId);
    return res.data.map((c) => ({ id: String(c.id), label: c.name }));
  }
  if (fk.table) {
    if (fk.dependsOn && !formValues[fk.dependsOn]) return [];
    // Global parents (org-types, tenant-domains, …) never take a tenant_id;
    // tenant-scoped parents (lead-stage, …) require the child's own tenant.
    // Getting this wrong for a global parent 400s the request server-side.
    const scopedTenantId = fk.scope === 'global' ? undefined : tenantId;
    const res = await lookupAdmin.list(fk.table, scopedTenantId);
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
export default function FkSelect({ field, value, onChange, formValues, tenantId, disabled, idPrefix, dependsOnLabel }: Props) {
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
    fetchOptions(field, formValues, tenantId)
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
    // config, the parent value it chains off, and the tenant scope. `formValues`
    // is otherwise excluded — every keystroke elsewhere would refetch options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fk?.table, fk?.endpoint, depValue, tenantId, parentPending]);

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
      {error && <p className="text-[11px] text-red-600">Couldn&apos;t load options — try again.</p>}
    </div>
  );
}
