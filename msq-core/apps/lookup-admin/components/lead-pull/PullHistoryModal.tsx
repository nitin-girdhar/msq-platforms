'use client';

import { useEffect, useState } from 'react';
import { Alert, Modal } from '@platform/ui-kit';
import { leadPull, type PullHistoryRow } from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  onClose: () => void;
}

const STATUS_CLASS: Record<string, string> = {
  applied: 'bg-status-success-container text-on-status-success-container',
  completed: 'bg-status-info-container text-on-status-info-container',
  failed: 'bg-error-container text-on-error-container',
  discarded: 'bg-surface-container text-on-surface-variant',
};

function when(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function num(counts: Record<string, unknown>, key: string): number | null {
  const v = counts[key];
  return typeof v === 'number' ? v : null;
}

// Summary of the tenant's past pulls. Staged leads are deleted when a new pull starts, so this
// keeps who/when/what was asked/how it ended — and none of the lead details.
export default function PullHistoryModal({ tenantId, onClose }: Props) {
  const [rows, setRows] = useState<PullHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    leadPull.history(tenantId)
      .then((res) => { if (!cancelled) setRows(res.data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  return (
    <Modal open onClose={onClose} title="Pull history" subtitle="Summary of past runs — no lead details are kept" closeOnBackdropClick maxWidth="max-w-4xl">
      {error && <Alert tone="error">{error}</Alert>}
      {loading && <p className="text-xs text-on-surface-variant">Loading…</p>}
      {!loading && !error && rows.length === 0 && <p className="text-xs text-on-surface-variant">No pulls recorded yet.</p>}
      {rows.length > 0 && (
        <div className="max-h-[28rem] overflow-auto rounded-xl border border-outline-variant">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-3 py-2 font-semibold">Started</th>
                <th className="px-3 py-2 font-semibold">By</th>
                <th className="px-3 py-2 font-semibold">Kind</th>
                <th className="px-3 py-2 font-semibold">Window</th>
                <th className="px-3 py-2 font-semibold">Result</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const since = typeof r.filters['since'] === 'string' ? (r.filters['since'] as string).slice(0, 10) : null;
                const until = typeof r.filters['until'] === 'string' ? (r.filters['until'] as string).slice(0, 10) : null;
                const staged = num(r.counts, 'total') ?? num(r.counts, 'staged');
                const applied = r.counts['apply'] as { applied?: number } | undefined;
                return (
                  <tr key={r.run_id} className="border-t border-outline-variant align-top">
                    <td className="px-3 py-2 text-on-surface">{when(r.started_at ?? r.created_at)}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{r.created_by_name ?? (r.trigger_kind === 'scheduled' ? 'Scheduler' : '—')}</td>
                    <td className="px-3 py-2 text-on-surface-variant capitalize">{r.trigger_kind}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{since ? `${since} → ${until ?? 'now'}` : '—'}</td>
                    <td className="px-3 py-2 text-on-surface-variant">
                      {staged !== null ? `${staged.toLocaleString()} staged` : '—'}
                      {applied?.applied !== undefined ? ` · ${applied.applied} applied` : ''}
                      {r.error_text && <span className="block text-error">{r.error_text}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${STATUS_CLASS[r.status] ?? 'bg-surface-container text-on-surface-variant'}`}>
                        {r.status}
                      </span>
                      {r.status === 'applied' && <span className="block text-[0.6875rem] text-on-surface-variant">{when(r.applied_at)}</span>}
                      {r.status === 'discarded' && <span className="block text-[0.6875rem] text-on-surface-variant">{when(r.discarded_at)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
