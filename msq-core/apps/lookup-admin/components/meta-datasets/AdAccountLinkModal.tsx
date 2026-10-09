'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal } from '@platform/ui-kit';
import { metaAdAccounts, metaDatasets, type MetaAdAccountRow, type MetaDatasetRow } from '@/src/lib/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  dataset: MetaDatasetRow | null;
}

// Which ad accounts feed this dataset. An ad account feeds exactly ONE dataset (the business runs 1:1), so
// accounts already linked to another dataset are shown but not selectable -- unlink them there first.
// Silently moving one would redirect every future event of that account's leads.
export default function AdAccountLinkModal({ open, onClose, onSaved, dataset }: Props) {
  const [accounts, setAccounts] = useState<MetaAdAccountRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !dataset) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearch('');
    setSelected(new Set(dataset.ad_account_ids));
    metaAdAccounts.list()
      .then((res) => { if (!cancelled) setAccounts(res.data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load ad accounts.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, dataset]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => !q || [a.name, a.ad_account_id, a.business_name].some((v) => v?.toLowerCase().includes(q)));
  }, [accounts, search]);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const save = async () => {
    if (!dataset) return;
    setSaving(true);
    setError(null);
    try {
      await metaDatasets.setAdAccounts(dataset.id, [...selected]);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link the ad accounts.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link ad accounts"
      subtitle={dataset ? `${dataset.name ?? dataset.dataset_id} · ${dataset.tenant_name ?? ''}` : undefined}
      locked={saving}
      maxWidth="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || loading} aria-busy={saving}>
            {saving ? 'Saving…' : `Save (${selected.size} linked)`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, id or business…"
          aria-label="Search ad accounts"
          className="min-h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm placeholder:text-outline sm:min-h-9"
        />
        <ul className="max-h-[50vh] divide-y divide-outline-variant overflow-y-auto rounded-lg border border-outline-variant">
          {loading && <li className="px-3 py-3 text-xs text-on-surface-variant">Loading…</li>}
          {!loading && visible.length === 0 && <li className="px-3 py-3 text-xs text-on-surface-variant">No ad accounts — sync them on the Ad Accounts tab first.</li>}
          {visible.map((a) => {
            const takenElsewhere = a.dataset_uuid !== null && a.dataset_uuid !== dataset?.id;
            return (
              <li key={a.ad_account_id} className="flex items-start gap-3 px-3 py-2">
                <input
                  id={`aa-${a.ad_account_id}`} type="checkbox" className="mt-1 accent-primary"
                  checked={selected.has(a.ad_account_id)} disabled={takenElsewhere}
                  onChange={(e) => toggle(a.ad_account_id, e.target.checked)}
                />
                <label htmlFor={`aa-${a.ad_account_id}`} className="min-w-0 flex-1 text-xs">
                  <span className="block font-semibold text-on-surface">{a.name ?? a.ad_account_id}</span>
                  <span className="block font-mono text-on-surface-variant">{a.ad_account_id}{a.business_name ? ` · ${a.business_name}` : ''}</span>
                  {takenElsewhere && (
                    <span className="block text-on-status-due-container">
                      Already feeds {a.dataset_label}{a.dataset_tenant_name ? ` (${a.dataset_tenant_name})` : ''}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
