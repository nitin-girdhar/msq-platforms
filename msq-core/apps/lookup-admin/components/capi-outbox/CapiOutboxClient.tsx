'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, LocalDateTime, Modal, PageBody, PageHeader, buildFilename, exportRows,
} from '@platform/ui-kit';
import MetaTabs from '@/components/meta-nav/MetaTabs';
import KpiTile from '@/components/meta-shared/KpiTile';
import FilterChip from '@/components/meta-shared/FilterChip';
import {
  capiOutbox,
  metaDatasets,
  type CapiOutboxDetail,
  type CapiOutboxFilters,
  type CapiOutboxRow,
  type CapiOutboxSummary,
  type CapiWorklistRow,
  type MetaDatasetRow,
  type OutboxStatus,
} from '@/src/lib/api/client';

interface Props {
  tenantId: string;
  tenantName: string | undefined;
}

type StatusView = Extract<OutboxStatus, 'SENT' | 'FAILED' | 'DEAD' | 'EXPIRED'> | 'OPEN' | 'SKIPPED';
type View = StatusView | 'ALL';

const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'OPEN', label: 'In flight' },
  { id: 'SENT', label: 'Sent' },
  { id: 'FAILED', label: 'Retrying' },
  { id: 'DEAD', label: 'Failed' },
  { id: 'EXPIRED', label: 'Expired' },
  { id: 'SKIPPED', label: 'Parked' },
  { id: 'ALL', label: 'All' },
];

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<OutboxStatus, string> = {
  PENDING: 'Queued',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Retrying',
  DEAD: 'Failed',
  EXPIRED: 'Expired',
  SKIPPED_NO_DATASET: 'Parked · no dataset',
  SKIPPED_TENANT_MISMATCH: 'Skipped · tenant mismatch',
  SKIPPED_NO_MAPPING: 'Skipped · no mapping',
  SKIPPED_NOT_META: 'Skipped · not a Meta lead',
  SKIPPED_AMBIGUOUS_DATASET: 'Parked · ambiguous dataset',
};

function statusTone(s: OutboxStatus): string {
  if (s === 'SENT') return 'bg-status-success-container text-on-status-success-container';
  if (s === 'DEAD') return 'bg-error-container text-on-error-container';
  if (s === 'FAILED' || s.startsWith('SKIPPED')) return 'bg-status-due-container text-on-status-due-container';
  return 'bg-surface-container text-on-surface-variant';
}

// What each stage change owes Meta, and what became of it. Rows are written in the stage-change transaction and
// delivered by the outbox worker with retry; a lead whose ad account has no dataset yet is PARKED (not lost) and
// is re-queued when a dataset is linked. Tenant-scoped: every read and write is RLS-pinned to this tenant.
export default function CapiOutboxClient({ tenantId, tenantName }: Props) {
  const [view, setView] = useState<View>('OPEN');
  const [datasetFilter, setDatasetFilter] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CapiOutboxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CapiOutboxSummary | null>(null);
  const [worklist, setWorklist] = useState<CapiWorklistRow[]>([]);
  const [datasets, setDatasets] = useState<MetaDatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<CapiOutboxDetail | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<'retry' | 'requeue' | null>(null);

  const datasetLabel = useMemo(() => new Map(datasets.map((d) => [d.id, d.name ?? d.dataset_id])), [datasets]);

  const filters: CapiOutboxFilters = useMemo(() => ({
    ...(view !== 'ALL' ? { status: view } : {}),
    ...(datasetFilter ? { dataset_id: datasetFilter } : {}),
    page,
    page_size: PAGE_SIZE,
  }), [view, datasetFilter, page]);

  // The newest request wins: switching the view quickly must not let a slower earlier answer replace the rows.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const [list, sum, wl] = await Promise.all([
        capiOutbox.list(tenantId, filters),
        capiOutbox.summary(tenantId),
        capiOutbox.worklist(tenantId),
      ]);
      if (mine !== seq.current) return;
      setRows(list.data);
      setTotal(list.total);
      setSummary(sum.data);
      setWorklist(wl.data);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : 'Could not load the outbox.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [tenantId, filters]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    metaDatasets.list(tenantId).then((res) => { if (!cancelled) setDatasets(res.data); }).catch(() => { if (!cancelled) setDatasets([]); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const changeView = (v: View) => { setView(v); setPage(1); };

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const retryOne = (id: string) => act(async () => {
    const r = await capiOutbox.retry(tenantId, [id]);
    return r.data.retried > 0 ? 'Queued for another attempt.' : 'Nothing to retry — it may be past Meta’s 7-day window.';
  });
  const dismissOne = (id: string) => act(async () => {
    await capiOutbox.dismiss(tenantId, [id]);
    return 'Dismissed — it will not be sent.';
  });
  const retryAll = () => act(async () => {
    setBulkConfirm(null);
    const r = await capiOutbox.retry(tenantId);
    return `${r.data.retried} event${r.data.retried === 1 ? '' : 's'} queued for another attempt.`;
  });
  const requeue = () => act(async () => {
    setBulkConfirm(null);
    const r = await capiOutbox.requeueSkipped(tenantId);
    return r.data.requeued > 0
      ? `${r.data.requeued} parked event${r.data.requeued === 1 ? '' : 's'} re-queued.`
      : 'Nothing could be re-queued yet — link the missing datasets first.';
  });

  const openDetail = async (id: string) => {
    try {
      const res = await capiOutbox.get(tenantId, id);
      setDetail(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the event.');
    }
  };

  const exportPage = () =>
    exportRows(
      rows,
      [
        { header: 'Created', value: (r: CapiOutboxRow) => r.created_at },
        { header: 'Event time', value: (r) => r.event_time },
        { header: 'Event', value: (r) => r.event_name },
        { header: 'Status', value: (r) => STATUS_LABEL[r.status] },
        { header: 'Attempts', value: (r) => r.attempts },
        { header: 'Dataset', value: (r) => (r.dataset_id ? datasetLabel.get(r.dataset_id) ?? r.dataset_id : '') },
        { header: 'Meta lead id', value: (r) => r.meta_lead_id },
        { header: 'Error', value: (r) => r.last_error },
        { header: 'Trace id', value: (r) => r.fb_trace_id },
      ],
      buildFilename(['capi-outbox', view.toLowerCase()]),
      'csv',
    );

  const count = (s: string) => summary?.by_status[s] ?? 0;
  const parked = count('SKIPPED_NO_DATASET') + count('SKIPPED_AMBIGUOUS_DATASET');
  const sent7d = summary?.datasets.reduce((n, d) => n + d.sent_7d, 0) ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="CAPI Outbox"
        scope={tenantName}
        subtitle="Conversion events owed to Meta"
        info="The lead-quality events each stage change owes Meta: which were sent, which failed and why, and which are parked for want of a dataset."
        tabs={<MetaTabs />}
        actions={
          <>
            <Button onClick={exportPage} disabled={rows.length === 0}>Export page</Button>
            <Button onClick={() => void load()} disabled={loading}>Refresh</Button>
          </>
        }
      />
      <PageBody dense>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <KpiTile label="Sent · 7 days" value={sent7d} note={summary?.last_sent_at ? 'Last sent shown below' : 'Nothing sent yet'} />
          <KpiTile label="In flight" value={count('PENDING') + count('SENDING')} note={summary?.oldest_open_at ? 'Oldest waiting since the time below' : 'Queue is clear'} />
          <KpiTile label="Retrying" value={count('FAILED')} note="Backing off, will retry" />
          <KpiTile label="Failed" value={count('DEAD')} note="Meta rejected them" />
          <KpiTile label="Parked" value={parked} note="No dataset linked yet" />
        </div>
        {summary && (summary.last_sent_at || summary.oldest_open_at) && (
          <p className="text-xs text-on-surface-variant">
            {summary.last_sent_at && <>Last event reached Meta <LocalDateTime value={summary.last_sent_at} />. </>}
            {summary.oldest_open_at && <>Oldest open event queued <LocalDateTime value={summary.oldest_open_at} />.</>}
          </p>
        )}

        {summary && summary.datasets.some((d) => d.dataset_id) && (
          <section className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest" aria-label="Per dataset health">
            <table className="w-full text-xs">
              <caption className="px-3 pt-3 text-left text-sm font-semibold text-on-surface">Per dataset</caption>
              <thead className="text-left text-on-surface-variant">
                <tr>
                  <th className="px-3 py-2">Dataset</th>
                  <th className="px-3 py-2">Sent 24h</th>
                  <th className="px-3 py-2">Failed 24h</th>
                  <th className="px-3 py-2">Sent 7d</th>
                  <th className="px-3 py-2">Failed 7d</th>
                  <th className="px-3 py-2">Expired 7d</th>
                  <th className="px-3 py-2">Open</th>
                  <th className="px-3 py-2">Last sent</th>
                </tr>
              </thead>
              <tbody>
                {summary.datasets.filter((d) => d.dataset_id).map((d) => {
                  const meta = datasets.find((x) => x.id === d.dataset_id);
                  return (
                    <tr key={d.dataset_id} className="border-t border-outline-variant">
                      <td className="px-3 py-2">
                        <span className="block font-medium text-on-surface">{datasetLabel.get(d.dataset_id!) ?? d.dataset_id}</span>
                        {meta && meta.status !== 'ACTIVE' && <span className="block text-on-status-due-container">{meta.status.replace('_', ' ').toLowerCase()}{meta.test_event_code ? ' · test mode' : ''}</span>}
                        {meta && meta.status === 'ACTIVE' && meta.test_event_code && <span className="block text-on-status-due-container">test mode — not used for optimisation</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{d.sent_24h}</td>
                      <td className={`px-3 py-2 tabular-nums ${d.failed_24h > 0 ? 'font-semibold text-on-error-container' : ''}`}>{d.failed_24h}</td>
                      <td className="px-3 py-2 tabular-nums">{d.sent_7d}</td>
                      <td className="px-3 py-2 tabular-nums">{d.failed_7d}</td>
                      <td className="px-3 py-2 tabular-nums">{d.expired_7d}</td>
                      <td className="px-3 py-2 tabular-nums">{d.open}</td>
                      <td className="whitespace-nowrap px-3 py-2">{d.last_sent_at ? <LocalDateTime value={d.last_sent_at} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {worklist.length > 0 && (
          <section className="space-y-2 rounded-xl border border-status-due/30 bg-status-due-container p-4" aria-labelledby="worklist-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="worklist-heading" className="text-sm font-semibold text-on-status-due-container">
                Leads waiting for a dataset
              </h2>
              <span className="flex flex-wrap gap-2">
                <Link href="/dashboard/meta-datasets" className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-container-low">
                  Link a dataset →
                </Link>
                <Button variant="primary" onClick={() => setBulkConfirm('requeue')} disabled={busy}>Re-queue parked</Button>
              </span>
            </div>
            <p className="text-xs text-on-status-due-container">
              These leads came from ad accounts (or branches) with no dataset. Their events are kept, not lost — link the ad account to a
              dataset, then re-queue. Anything older than Meta&apos;s 7-day window will expire instead.
            </p>
            <div className="overflow-x-auto rounded-lg bg-surface-container-lowest">
              <table className="w-full text-xs">
                <thead className="text-left text-on-surface-variant">
                  <tr><th className="px-3 py-2">Ad account</th><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Leads</th><th className="px-3 py-2">Events</th><th className="px-3 py-2">Waiting since</th></tr>
                </thead>
                <tbody>
                  {worklist.map((w) => (
                    <tr key={`${w.ad_account_id}-${w.org_id}`} className="border-t border-outline-variant">
                      <td className="px-3 py-2 font-mono">{w.ad_account_id ?? 'Unknown (campaign not fetched yet)'}</td>
                      <td className="px-3 py-2">{w.org_name ?? w.org_id}</td>
                      <td className="px-3 py-2 tabular-nums">{w.leads}</td>
                      <td className="px-3 py-2 tabular-nums">{w.events}</td>
                      <td className="px-3 py-2"><LocalDateTime value={w.oldest} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div role="group" aria-label="Outbox view" className="inline-flex flex-wrap overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
            {VIEWS.map((v) => (
              <FilterChip key={v.id} on={view === v.id} onClick={() => changeView(v.id)}>{v.label}</FilterChip>
            ))}
          </div>
          <select
            value={datasetFilter} onChange={(e) => { setDatasetFilter(e.target.value); setPage(1); }} aria-label="Filter by dataset"
            className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 text-sm text-on-surface sm:min-h-8 sm:text-xs"
          >
            <option value="">All datasets</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name ?? d.dataset_id}</option>)}
          </select>
          {(view === 'FAILED' || view === 'DEAD' || view === 'ALL') && (
            <Button onClick={() => setBulkConfirm('retry')} disabled={busy || count('FAILED') + count('DEAD') === 0}>Retry all failed</Button>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-xs">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-3 py-2">Event time</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Dataset</th>
                <th className="px-3 py-2">Meta lead</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-on-surface-variant">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-on-surface-variant">Nothing here.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-outline-variant align-top">
                  <td className="whitespace-nowrap px-3 py-2"><LocalDateTime value={r.event_time} /></td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-on-surface">{r.event_name}</span>
                    {r.is_negative && <span className="ml-1 text-on-surface-variant">(negative)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${statusTone(r.status)}`}>{STATUS_LABEL[r.status]}</span>
                    {r.last_error && <span className="mt-1 block max-w-sm text-on-surface-variant">{r.last_error}</span>}
                  </td>
                  <td className="px-3 py-2">{r.dataset_id ? datasetLabel.get(r.dataset_id) ?? r.dataset_id : <span className="text-on-surface-variant">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-on-surface-variant">{r.meta_lead_id}</td>
                  <td className="px-3 py-2 tabular-nums">{r.attempts}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className="inline-flex gap-1">
                      <Button size="sm" onClick={() => void openDetail(r.id)}>Details</Button>
                      {(r.status === 'FAILED' || r.status === 'DEAD') && (
                        <Button size="sm" variant="primary" onClick={() => void retryOne(r.id)} disabled={busy}>Retry</Button>
                      )}
                      {['PENDING', 'FAILED', 'DEAD'].includes(r.status) || r.status.startsWith('SKIPPED') ? (
                        <Button size="sm" onClick={() => void dismissOne(r.id)} disabled={busy}>Dismiss</Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
          <span>{total.toLocaleString()} event{total === 1 ? '' : 's'} · page {page} of {pages}</span>
          <span className="inline-flex gap-1">
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>Previous</Button>
            <Button size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages || loading}>Next</Button>
          </span>
        </div>
      </PageBody>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.event_name} · ${STATUS_LABEL[detail.status]}` : 'Event'}
        maxWidth="max-w-3xl"
        closeOnBackdropClick
      >
        {detail && (
          <div className="space-y-3 text-xs">
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <dt className="text-on-surface-variant">Meta lead</dt><dd className="font-mono">{detail.meta_lead_id}</dd>
              <dt className="text-on-surface-variant">Event time</dt><dd><LocalDateTime value={detail.event_time} /></dd>
              <dt className="text-on-surface-variant">Expires</dt><dd><LocalDateTime value={detail.expires_at} /></dd>
              <dt className="text-on-surface-variant">Attempts</dt><dd>{detail.attempts}</dd>
              <dt className="text-on-surface-variant">Trace id</dt><dd className="font-mono">{detail.fb_trace_id ?? '—'}</dd>
              <dt className="text-on-surface-variant">Triggered by</dt><dd>{detail.triggered_by}</dd>
            </dl>
            {detail.last_error && <Alert tone="error">{detail.last_error}</Alert>}
            <div>
              <h3 className="mb-1 font-semibold text-on-surface">Sent to Meta</h3>
              <pre className="max-h-64 overflow-auto rounded-lg bg-surface-container p-3 font-mono text-[0.6875rem] text-on-surface">{detail.request_payload ? JSON.stringify(detail.request_payload, null, 2) : 'Not sent yet.'}</pre>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-on-surface">Meta&apos;s answer</h3>
              <pre className="max-h-48 overflow-auto rounded-lg bg-surface-container p-3 font-mono text-[0.6875rem] text-on-surface">{detail.response_payload ? JSON.stringify(detail.response_payload, null, 2) : '—'}</pre>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={bulkConfirm !== null}
        onClose={() => setBulkConfirm(null)}
        title={bulkConfirm === 'retry' ? 'Retry every failed event?' : 'Re-queue the parked events?'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkConfirm(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void (bulkConfirm === 'retry' ? retryAll() : requeue())}>
              {bulkConfirm === 'retry' ? 'Retry all' : 'Re-queue'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-on-surface">
          {bulkConfirm === 'retry'
            ? 'Every failed or retrying event still inside Meta’s 7-day window is queued for another attempt for this tenant. Events past the window stay expired.'
            : 'Each parked lead is matched to its dataset again (ad account first, then its branch). Leads that still have no dataset stay parked; events past Meta’s 7-day window are expired.'}
        </p>
      </Modal>
    </>
  );
}
