'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lookupAdmin } from '@/src/lib/api/client';
import type { LookupTableDef, FormValues } from '@/src/lib/lookupTableConfig';
import { Modal, Button } from '@platform/ui-kit';
import LookupForm from './LookupForm';

interface Props {
  open: boolean;
  onClose: () => void;
  table: string;
  config: LookupTableDef;
  // Scopes the create request itself (tenant-scoped tables only).
  tenantId?: string | undefined;
  // The app-wide tenant from the navbar. Seeds a `tenant_id` COLUMN on tables
  // that carry one (Organizations) so it is never re-picked per form.
  scopeTenantId?: string | undefined;
  // Scopes the create request itself (org-scoped tables only, e.g. Designations).
  orgId?: string | undefined;
}

// The submit button lives in the Modal's pinned footer, outside the <form>;
// the HTML `form` attribute is what still wires it to this form.
const FORM_ID = 'create-lookup-form';

const TENANT_KEY = 'tenant_id';

function initialValues(config: LookupTableDef, scopeTenantId?: string): FormValues {
  const values: FormValues = {};
  for (const field of config.fields) {
    if (field.type === 'boolean') values[field.key] = false;
    else if (field.key === TENANT_KEY && scopeTenantId) values[field.key] = scopeTenantId;
    else values[field.key] = '';
  }
  return values;
}

export default function CreateLookupModal({ open, onClose, table, config, tenantId, scopeTenantId, orgId }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => initialValues(config, scopeTenantId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues(config, scopeTenantId));
    setError(null);
  }, [open, config, scopeTenantId]);

  const handleClose = () => {
    if (pending) return;
    setError(null);
    onClose();
  };

  // Typing a reserved name (org_admin, …) pins Rank to the platform's fixed
  // value as you type, so the locked field never shows a stale number the
  // server is about to overwrite.
  const reservedRank = config.reservedRanks?.[String(values['name'] ?? '')];

  const setField = (key: string, value: string | number | boolean) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'name') {
        const pinned = config.reservedRanks?.[String(value)];
        if (pinned !== undefined) next['rank'] = pinned;
      }
      return next;
    });
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
      await lookupAdmin.create(table, body, tenantId, orgId);
      router.refresh();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPending(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={handleClose} disabled={pending}>
        Cancel
      </Button>
      <Button variant="primary" type="submit" form={FORM_ID} disabled={pending} aria-busy={pending}>
        {pending && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        )}
        {pending ? 'Creating…' : 'Create'}
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title={`New ${config.title.replace(/s$/, '')}`} locked={pending} footer={footer}>
      <LookupForm
        formId={FORM_ID}
        idPrefix="cl"
        config={config}
        values={values}
        setField={setField}
        disabled={pending}
        tenantId={tenantId}
        orgId={orgId}
        lockedKeys={[
          ...(scopeTenantId ? [TENANT_KEY] : []),
          ...(reservedRank !== undefined ? ['rank'] : []),
        ]}
        lockedHints={{
          [TENANT_KEY]: 'Set by the tenant selected in the top bar.',
          rank: 'Fixed for this role — set by the platform.',
        }}
        error={error}
        onSubmit={handleSubmit}
      />
    </Modal>
  );
}
