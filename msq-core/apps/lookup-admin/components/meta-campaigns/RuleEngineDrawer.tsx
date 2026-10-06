'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@platform/ui-kit';
import { campaignTypes, type CampaignTypeRuleRow } from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  onClose: () => void;
}

const FIELD_LABEL: Record<string, string> = {
  campaign_name: 'Campaign name',
  form_name: 'Form name',
  adset_name: 'Ad set name',
  ad_name: 'Ad name',
};

// The tenant's ordered keyword rules, first match wins. Reorder and save here; adding,
// editing or removing a rule stays on Campaign Types, where the pattern can be tested.
export default function RuleEngineDrawer({ tenantId, onClose }: Props) {
  const [rules, setRules] = useState<CampaignTypeRuleRow[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    campaignTypes.rules(tenantId)
      .then((res) => {
        if (cancelled) return;
        const sorted = [...res.data].sort((a, b) => a.rule_order - b.rule_order);
        setRules(sorted);
        setOriginal(sorted.map((r) => r.id));
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the rules.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const move = (index: number, delta: -1 | 1) => {
    setSaved(false);
    setRules((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
  };

  const dirty = rules.some((r, i) => r.id !== original[i]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // The WHOLE live list in its new order — partial lists are refused by the API.
      await campaignTypes.reorderRules(tenantId, rules.map((r) => r.id));
      setOriginal(rules.map((r) => r.id));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the rule order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-on-surface/30" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label="Ordered keyword routing rules" className="flex h-full w-full max-w-md flex-col border-l border-outline-variant bg-surface-container-lowest shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-outline-variant px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-on-surface">Ordered keyword routing rules</h2>
            <p className="text-xs text-on-surface-variant">Evaluated top to bottom; the first match wins.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container">✕</button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {error && <Alert tone="error">{error}</Alert>}
          {saved && <Alert tone="success">Rule order saved.</Alert>}
          {loading && <p className="text-xs text-on-surface-variant">Loading…</p>}
          {!loading && rules.length === 0 && (
            <p className="text-xs text-on-surface-variant">No rules yet. Campaigns with no match are flagged for manual mapping.</p>
          )}
          <ol className="space-y-2">
            {rules.map((r, i) => (
              <li key={r.id} className={`rounded-lg border border-outline-variant p-3 ${r.is_active ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-on-surface-variant">
                      {String(i + 1).padStart(2, '0')} · {FIELD_LABEL[r.match_field] ?? r.match_field}
                    </p>
                    <p className="break-all font-mono text-xs text-on-surface">{r.pattern}</p>
                    <p className="text-xs text-on-surface-variant">
                      Assigns → <strong className="text-on-surface">{r.campaign_type_label ?? '—'}</strong>
                      {!r.is_active && ' (inactive)'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0 || saving} aria-label={`Move rule ${i + 1} up`} className="h-7 w-7 rounded-md border border-outline-variant text-xs text-on-surface-variant hover:bg-surface-container disabled:opacity-40">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rules.length - 1 || saving} aria-label={`Move rule ${i + 1} down`} className="h-7 w-7 rounded-md border border-outline-variant text-xs text-on-surface-variant hover:bg-surface-container disabled:opacity-40">↓</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {!loading && (
            <p className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
              <strong className="text-on-surface">Fallback.</strong> A campaign no rule matches is flagged for manual mapping.
            </p>
          )}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-outline-variant px-4 py-3">
          <Link href="/dashboard/campaign-types" className="text-xs font-semibold text-primary hover:underline">Add or edit rules →</Link>
          <Button variant="primary" onClick={save} disabled={!dirty || saving} aria-busy={saving}>
            {saving ? 'Saving…' : 'Save Rule Order'}
          </Button>
        </footer>
      </aside>
    </div>
  );
}
