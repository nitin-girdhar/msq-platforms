'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Modal } from '@platform/ui-kit';
import { metaDatasets, type MetaDatasetRow, type MetaPortfolioRow } from '@/src/lib/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** null = create under `portfolio`. */
  row: MetaDatasetRow | null;
  /** The portfolio a new dataset is filed under. */
  portfolio: MetaPortfolioRow | null;
}

const field = 'min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface placeholder:text-outline sm:min-h-9';

// A dataset (pixel) conversion events are sent to. The tenant is inherited from the portfolio, so a dataset
// cannot be filed under a different tenant than its owner.
export default function DatasetModal({ open, onClose, onSaved, row, portfolio }: Props) {
  const isEdit = row !== null;
  const [datasetId, setDatasetId] = useState('');
  const [name, setName] = useState('');
  const [testCode, setTestCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDatasetId(row?.dataset_id ?? '');
    setName(row?.name ?? '');
    setTestCode(row?.test_event_code ?? '');
    setError(null);
  }, [open, row]);

  const valid = isEdit || /^\d{5,32}$/.test(datasetId.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await metaDatasets.update(row.id, {
          ...(name.trim() ? { name: name.trim() } : {}),
          test_event_code: testCode.trim() ? testCode.trim() : null,
        });
      } else if (portfolio) {
        await metaDatasets.create({
          portfolio_id: portfolio.id,
          dataset_id: datasetId.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(testCode.trim() ? { test_event_code: testCode.trim() } : {}),
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the dataset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit dataset' : 'Add dataset'}
      subtitle={isEdit ? `${row.tenant_name ?? ''} · ${row.portfolio_name ?? row.portfolio_id}` : `${portfolio?.tenant_name ?? ''} · ${portfolio?.name ?? portfolio?.meta_business_id ?? ''}`}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !valid} aria-busy={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
          Dataset (pixel) id
          <input inputMode="numeric" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} disabled={isEdit || saving}
            placeholder="Events Manager → Data sources → Dataset ID" className={field} />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} className={field} />
        </label>
        <label className="block space-y-1 text-xs font-semibold text-on-surface-variant">
          Test event code (optional)
          <input value={testCode} onChange={(e) => setTestCode(e.target.value)} disabled={saving} placeholder="TEST12345" className={field} />
        </label>
        <p className="text-[0.6875rem] text-on-surface-variant">
          While a test event code is set, every event sent to this dataset appears under Events Manager → Test events and is
          <strong> not</strong> used for optimisation. Clear it to go live.
        </p>
        <p className="text-[0.6875rem] text-on-status-due-container">
          Events sent in test mode count as delivered and are <strong>not</strong> re-sent when you clear the code — keep test mode to a
          short check on a quiet dataset.
        </p>
      </div>
    </Modal>
  );
}
