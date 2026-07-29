'use client';

import type { LookupTableDef, FormValues } from '@/src/lib/lookupTableConfig';
import FkSelect from './FkSelect';

interface Props {
  formId: string;
  idPrefix: string;
  config: LookupTableDef;
  values: FormValues;
  setField: (key: string, value: string | number | boolean) => void;
  disabled: boolean;
  tenantId?: string | undefined;
  error?: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

const INPUT_CLASS =
  'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

// Field renderer shared by Create/EditLookupModal — the ~150 lines of field
// JSX used to be duplicated between them near-verbatim. Owns nothing but
// rendering; form state and submit/validation stay with the caller since
// Create and Edit build very different bodies (fresh values vs. a dirty diff).
export default function LookupForm({ formId, idPrefix, config, values, setField, disabled, tenantId, error, onSubmit }: Props) {
  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {config.fields.map((field) => {
        if (field.type === 'fk') {
          const dependsOnLabel = field.fk?.dependsOn
            ? config.fields.find((f) => f.key === field.fk?.dependsOn)?.label
            : undefined;
          return (
            <FkSelect
              key={field.key}
              field={field}
              value={(values[field.key] as string) ?? ''}
              onChange={(v) => setField(field.key, v)}
              formValues={values}
              tenantId={tenantId}
              disabled={disabled}
              idPrefix={idPrefix}
              dependsOnLabel={dependsOnLabel}
            />
          );
        }

        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            {field.type !== 'boolean' && (
              <label htmlFor={`${idPrefix}-${field.key}`} className="text-xs font-semibold text-[#0F172A]">
                {field.label}{field.required ? ' *' : ''}
              </label>
            )}

            {field.type === 'text' && (
              <input
                id={`${idPrefix}-${field.key}`}
                type="text"
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={disabled}
                required={field.required}
                className={INPUT_CLASS}
              />
            )}

            {field.type === 'textarea' && (
              <textarea
                id={`${idPrefix}-${field.key}`}
                value={values[field.key] as string}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={disabled}
                rows={3}
                className={INPUT_CLASS}
              />
            )}

            {field.type === 'number' && (
              <input
                id={`${idPrefix}-${field.key}`}
                type="number"
                value={values[field.key] as string | number}
                onChange={(e) => setField(field.key, e.target.value)}
                disabled={disabled}
                required={field.required}
                className={INPUT_CLASS}
              />
            )}

            {field.type === 'boolean' && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={values[field.key] as boolean}
                  onChange={(e) => setField(field.key, e.target.checked)}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-[#E2E8F0] text-[#0b6cbf] focus:ring-[#0b6cbf]/20"
                />
                <span>{field.label}</span>
              </label>
            )}
          </div>
        );
      })}
    </form>
  );
}
