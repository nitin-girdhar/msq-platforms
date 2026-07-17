'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lookupAdmin } from '@/src/lib/api/client';
import type { LookupTableDef } from '@/src/lib/lookupTableConfig';
import Modal from './Modal';
import GeoCascadeSelect, { type GeoValues } from './GeoCascadeSelect';

interface Props {
  open: boolean;
  onClose: () => void;
  table: string;
  config: LookupTableDef;
}

type FormValues = Record<string, string | number | boolean>;

interface SelectOptionRow {
  id: string;
  name: string;
  label: string;
  is_active: boolean;
}

function initialValues(config: LookupTableDef): FormValues {
  const values: FormValues = {};
  for (const field of config.fields) {
    if (field.type === 'boolean') values[field.key] = false;
    else values[field.key] = '';
  }
  return values;
}

export default function CreateLookupModal({ open, onClose, table, config }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => initialValues(config));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectOptions, setSelectOptions] = useState<Record<string, SelectOptionRow[]>>({});

  const selectFields = config.fields.filter((f) => f.type === 'select' && f.selectOptionsFrom);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues(config));
    setError(null);

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
    if (pending) return;
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

  const handleSubmit = async (e: React.FormEvent) => {
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

    const body: Record<string, unknown> = {};
    for (const field of config.fields) {
      const v = values[field.key];
      if (field.type === 'number') {
        body[field.key] = v === '' ? undefined : Number(v);
      } else if (field.type === 'boolean') {
        body[field.key] = Boolean(v);
      } else {
        body[field.key] = v === '' ? undefined : v;
      }
    }

    setPending(true);
    try {
      await lookupAdmin.create(table, body);
      router.refresh();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={`New ${config.title.replace(/s$/, '')}`} locked={pending}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {config.fields.map((field) => {
          // The three geo-select fields (country_id/state_id/city_id) render
          // together as a single cascading control — only emit it once, on
          // the first of the three, and skip the other two individually.
          if (field.type === 'geo-select') {
            if (field.key !== 'country_id') return null;
            return (
              <GeoCascadeSelect
                key="geo-cascade"
                idPrefix="cl"
                values={geoValues}
                onChange={setGeoValues}
                disabled={pending}
              />
            );
          }

          return (
          <div key={field.key} className="flex flex-col gap-1.5">
            {field.type !== 'boolean' && (
              <label htmlFor={`cl-${field.key}`} className="text-xs font-semibold text-[#0F172A]">
                {field.label}{field.required ? ' *' : ''}
              </label>
            )}

            {field.type === 'text' && (
              <input
                id={`cl-${field.key}`}
                type="text"
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={pending}
                required={field.required}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            )}

            {field.type === 'textarea' && (
              <textarea
                id={`cl-${field.key}`}
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={pending}
                rows={3}
                className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
              />
            )}

            {field.type === 'number' && (
              <input
                id={`cl-${field.key}`}
                type="number"
                value={values[field.key] as string | number}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={pending}
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
                  disabled={pending}
                  className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
                />
                <span>{field.label}</span>
              </label>
            )}

            {field.type === 'select' && (
              <select
                id={`cl-${field.key}`}
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={pending}
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

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={handleClose} disabled={pending}
            className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={pending} aria-busy={pending}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white hover:bg-[#095699] disabled:cursor-not-allowed disabled:opacity-70">
            {pending && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
            )}
            {pending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
