'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lookupAdmin } from '@/src/lib/api/client';
import type { LookupTableDef, FormValues } from '@/src/lib/lookupTableConfig';
import type { LookupRow } from './LookupTable';
import { Modal, Button } from '@platform/ui-kit';
import LookupForm from './LookupForm';

interface Props {
  open: boolean;
  onClose: () => void;
  table: string;
  config: LookupTableDef;
  row: LookupRow;
  tenantId?: string | undefined;
}

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'edit-lookup-form';

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

export default function EditLookupModal({ open, onClose, table, config, row, tenantId }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => valuesFromRow(config, row));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState(false);

  useEffect(() => {
    setValues(valuesFromRow(config, row));
    setError(null);
  }, [row, config]);

  const handleClose = () => {
    if (pending || statusPending) return;
    setError(null);
    onClose();
  };

  const setField = (key: string, value: string | number | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
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
      await lookupAdmin.update(table, row.id, patch, tenantId);
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
      await lookupAdmin.update(table, row.id, { is_active: !row.is_active }, tenantId);
      router.refresh();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setStatusPending(false);
    }
  };

  const locked = pending || statusPending;

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        {row.is_active ? (
          <Button
            variant="danger"
            onClick={handleToggleActive}
            disabled={locked}
            aria-busy={statusPending}
          >
            {statusPending ? 'Deactivating…' : 'Deactivate'}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={handleToggleActive}
            disabled={locked}
            aria-busy={statusPending}
            className="!border-emerald-200 !text-emerald-700 hover:!bg-emerald-50"
          >
            {statusPending ? 'Reactivating…' : 'Reactivate'}
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleClose} disabled={locked}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={FORM_ID} disabled={locked} aria-busy={pending}>
          {pending && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          )}
          Save changes
        </Button>
      </div>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title={`Edit ${row.label || row.name}`} locked={locked} footer={footer}>
      <LookupForm
        formId={FORM_ID}
        idPrefix="el"
        config={config}
        values={values}
        setField={setField}
        disabled={locked}
        tenantId={tenantId}
        error={error}
        onSubmit={handleSave}
      />
    </Modal>
  );
}
