'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lookupAdmin } from '@/src/lib/api/client';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';
import type { LookupRow } from './LookupTable';
import Modal from './Modal';
import GeoCascadeSelect, { type GeoValues } from './GeoCascadeSelect';

interface Props {
  open: boolean;
  onClose: () => void;
  table: string;
  config: LookupTableDef;
  row: LookupRow;
}

type FormValues = Record<string, string | number | boolean>;

interface SelectOptionRow {
  id: string;
  name: string;
  label: string;
  is_active: boolean;
}

function valuesFromRow(config: LookupTableDef, row: LookupRow): FormValues {
  const values: FormValues = {};
  for (const field of config.fields) {
    const raw = row[field.key];
    if (field.type === 'boolean') values[field.key] = Boolean(raw);
    else if (field.type === 'number') values[field.key] = (raw ?? '') as number | string;
    else values[field.key] = (raw ?? '') as string;
  }
  return values;
}

export default function EditLookupModal({ open, onClose, table, config, row }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => valuesFromRow(config, row));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [selectOptions, setSelectOptions] = useState<Record<string, SelectOptionRow[]>>({});

  const selectFields = config.fields.filter((f) => f.type === 'select' && f.selectOptionsFrom);

  useEffect(() => {
    setValues(valuesFromRow(config, row));
    setError(null);
  }, [row, config]);

  useEffect(() => {
    if (!open) return;
    for (const field of selectFields) {
      const parentTable = field.selectOptionsFrom;
      if (!parentTable) continue;
      lookupAdmin.list(parentTable)
        .then((res) => {
          const rows = (res.data as unknown as SelectOptionRow[]).filter((r) => r.is_active);
          setSelectOptions((prev) => ({ ...prev, [field.key]: rows }));
        })
        .catch(() => {
          setSelectOptions((prev) => ({ ...prev, [field.key]: [] }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table]);

  const handleClose = () => {
    if (pending || statusPending) return;
    setError(null);
    onClose();
  };

  const setField = (key: string, value: string | number | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const geoValues: GeoValues = {
    country_id: (values.country_id as string) ?? '',
    state_id: (values.state_id as string) ?? '',
    city_id: (values.city_id as string) ?? '',
  };
  const setGeoValues = (next: GeoValues) => {
    setValues((prev) => ({ ...prev, ...next }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    for (const field of config.fields) {
      if (!field.required) continue;
      const v = values[field.key];
      if (v === '' || v === undefined || v === null) {
        setError(`${field.label} is required.`);
        return;
      }
    }

    const patch: Record<string, unknown> = {};
    for (const field of config.fields) {
      const current = values[field.key];
      const original = row[field.key];

      if (field.type === 'number') {
        const currentNum = current === '' ? null : Number(current);
        const originalNum = original === undefined || original === null ? null : Number(original);
        if (currentNum !== originalNum) patch[field.key] = currentNum;
      } else if (field.type === 'boolean') {
        const currentBool = Boolean(current);
        const originalBool = Boolean(original);
        if (currentBool !== originalBool) patch[field.key] = currentBool;
      } else {
        const currentStr = (current ?? '') as string;
        const originalStr = (original ?? '') as string;
        if (currentStr !== originalStr) patch[field.key] = currentStr === '' ? null : currentStr;
      }
    }

    if (Object.keys(patch).length === 0) {
      handleClose();
      return;
    }

    setPending(true);
    try {
      await lookupAdmin.update(table, row.id, patch);
      router.refresh();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  const handleToggleActive = async () => {
    setError(null);
    setStatusPending(true);
    try {
      await lookupAdmin.update(table, row.id, { is_active: !row.is_active });
      router.refresh();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setStatusPending(false);
    }
  };

  const locked = pending || statusPending;

  return (
    <Modal open={open} onClose={handleClose} title={`Edit ${row.label || row.name}`} locked={locked}>
      <form onSubmit={handleSave} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {config.fields.map((field) => {
          if (field.type === 'geo-select') {
            if (field.key !== 'country_id') return null;
            return (
              <GeoCascadeSelect
                key="geo-cascade"
                idPrefix="el"
                values={geoValues}
                onChange={setGeoValues}
                disabled={locked}
              />
            );
          }

          return (
          <div key={field.key} className="flex flex-col gap-1.5">
            {field.type !== 'boolean' && (
              <label htmlFor={`el-${field.key}`} className="text-xs font-semibold text-[#0F172A]">
                {field.label}{field.required ? ' *' : ''}
              </label>
            )}

            {field.type === 'text' && (
              <input
                id={`el-${field.key}`}
                type="text"
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={locked}
                required={field.required}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            )}

            {field.type === 'textarea' && (
              <textarea
                id={`el-${field.key}`}
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={locked}
                rows={3}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            )}

            {field.type === 'number' && (
              <input
                id={`el-${field.key}`}
                type="number"
                value={values[field.key] as string | number}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={locked}
                required={field.required}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            )}

            {field.type === 'boolean' && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={values[field.key] as boolean}
                  onChange={(e) => setField(field.key, e.target.checked)}
                  disabled={locked}
                  className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
                />
                <span>{field.label}</span>
              </label>
            )}

            {field.type === 'select' && (
              <select
                id={`el-${field.key}`}
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={locked}
                required={field.required}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              >
                <option value="">— Select {field.label} —</option>
                {(selectOptions[field.key] ?? []).map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label} ({opt.name})</option>
                ))}
              </select>
            )}
          </div>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div>
            {row.is_active ? (
              <button
                type="button"
                onClick={handleToggleActive}
                disabled={locked}
                aria-busy={statusPending}
                className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {statusPending ? 'Deactivating…' : 'Deactivate'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleToggleActive}
                disabled={locked}
                aria-busy={statusPending}
                className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {statusPending ? 'Reactivating…' : 'Reactivate'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleClose} disabled={locked}
              className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={locked} aria-busy={pending}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-3 py-2 text-xs font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-70">
              {pending && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              )}
              Save changes
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
