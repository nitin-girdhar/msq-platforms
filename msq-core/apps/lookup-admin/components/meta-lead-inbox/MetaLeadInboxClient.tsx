'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, PageBody, PageHeader } from '@platform/ui-kit';
import MetaTabs from '@/components/meta-nav/MetaTabs';
import {
  metaLeadInbox,
  type InboxReason,
  type InboxStatus,
  type MetaLeadInboxRow,
} from '@/src/lib/api/client';

const REASON_LABELS: Record<InboxReason, string> = {
  unmapped: 'Page/form not mapped to a branch',
  missing_contact: 'No phone number on the lead',
  sync_failed: 'Could not be saved',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

interface Props {
  // The administered tenant, or null when none is selected — then only the
  // tenant-less rows (pages mapped to nobody) are shown.
  tenantId: string | null;
  /** Named in the header so a login-time tenant reset is visible here. Absent
   *  when no tenant is selected — the rows on show then belong to no tenant. */
  tenantName: string | undefined;
}

// Webhook leads that did NOT become an LMS lead (schema 1.51.0). They used to be
// a log line only, and Meta never redelivers them because the webhook answers
// 200 regardless. Fix the cause (usually: map the page on Meta Page Mapping),
// then Retry — the lead goes through the same write path as the webhook, so it
// is typed and assigned exactly as if it had arrived normally.
export default function MetaLeadInboxClient({ tenantId, tenantName }: Props) {
  // 'tenant' = the selected tenant's rows; 'unowned' = pages no tenant maps yet.
  const [scope, setScope] = useState<'tenant' | 'unowned'>(tenantId ? 'tenant' : 'unowned');
  const [status, setStatus] = useState<InboxStatus>('open');
  const [rows, setRows] = useState<MetaLeadInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const scopedTenant = scope === 'tenant' ? tenantId : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await metaLeadInbox.list(scopedTenant, status);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
    }
  }, [scopedTenant, status]);

  useEffect(() => { void load(); }, [load]);

  const retry = async (row: MetaLeadInboxRow) => {
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const res = await metaLeadInbox.retry(scopedTenant, row.id);
      setNotice(
        res.data.duplicate
          ? `Lead ${row.meta_lead_id} was already in LMS — marked resolved.`
          : `Lead ${row.meta_lead_id} created${res.data.assigned_user_id ? ' and assigned' : ' (left unassigned — check the pool)'}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setBusyId(null);
    }
  };

  const ignore = async (row: MetaLeadInboxRow) => {
    if (!window.confirm(`Ignore lead ${row.meta_lead_id}? It will not be imported.`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      await metaLeadInbox.ignore(scopedTenant, row.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not ignore.');
    } finally {
      setBusyId(null);
    }
  };

  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const shownRows = q
    ? rows.filter((r) =>
        [r.lead_name, r.meta_lead_id, r.page_id, r.form_id, r.error_text].some((v) => (v ?? '').toLowerCase().includes(q)),
      )
    : rows;
  const countOf = (reason: InboxReason) => rows.filter((r) => r.reason === reason).length;

  const select = 'min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 text-sm text-on-surface sm:min-h-8 sm:text-xs';
  const statusChip = (on: boolean) =>
    `inline-flex min-h-11 items-center px-3 text-xs font-semibold transition-colors sm:min-h-8 ${
      on ? 'bg-primary-fixed text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-low'
    }`;
  const STATUSES: { value: InboxStatus; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'ignored', label: 'Ignored' },
  ];
  const stats: { label: string; value: number }[] = [
    { label: 'In this view', value: rows.length },
    { label: 'Unmapped page / form', value: countOf('unmapped') },
    { label: 'No phone number', value: countOf('missing_contact') },
    { label: 'Could not be saved', value: countOf('sync_failed') },
  ];

  return (
    <>
      <PageHeader
        title="Meta Lead Review Inbox"
        scope={tenantName}
        subtitle="Leads Meta delivered that could not be created"
        tabs={<MetaTabs />}
      />
      <PageBody>
        <p className="max-w-3xl rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
          Fix the cause — for an unmapped page, map it on{' '}
          <Link href="/dashboard/meta-mappings" className="font-semibold text-primary hover:underline">Meta Page Mapping</Link>{' '}
          — then Retry. A retried lead is typed and assigned exactly as a live one.
        </p>

        {!loading && (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-on-surface-variant">{s.label}</p>
                <p className="font-mono text-2xl font-bold tabular-nums text-on-surface">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={scope} onChange={(e) => setScope(e.target.value as 'tenant' | 'unowned')} aria-label="Inbox scope" className={select}>
            <option value="tenant" disabled={!tenantId}>Selected tenant{tenantId ? '' : ' (pick one in the top bar)'}</option>
            <option value="unowned">Pages mapped to no tenant</option>
          </select>
          <div role="group" aria-label="Inbox status" className="inline-flex overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" aria-pressed={status === s.value} onClick={() => setStatus(s.value)} className={statusChip(status === s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lead name, lead ID, page or form…"
            aria-label="Search inbox"
            className={`${select} min-w-0 flex-1 basis-56 placeholder:text-outline`}
          />
          <Button variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => void load()} disabled={loading}>Refresh</Button>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-xs">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Why it did not land</th>
                <th className="px-3 py-2">Page / form</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-3 py-4 text-center text-on-surface-variant">Loading…</td></tr>}
              {!loading && shownRows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-on-surface-variant">Nothing here.</td></tr>
              )}
              {!loading && shownRows.map((r) => (
                <tr key={r.id} className="border-t border-outline-variant align-top">
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(r.lead_created_at ?? r.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-on-surface">{r.lead_name ?? '—'}</span>
                    <span className="block font-mono text-on-surface-variant">{r.meta_lead_id}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded-md bg-status-due-container px-2 py-0.5 font-semibold text-on-status-due-container">
                      {REASON_LABELS[r.reason]}
                    </span>
                    {r.error_text && <span className="block text-on-surface-variant">{r.error_text}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-on-surface-variant">
                    {r.page_id ?? '—'}
                    <span className="block">{r.form_id ?? ''}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.attempts}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.status === 'open' && (
                      <span className="inline-flex gap-1">
                        <Button variant="primary" className="min-h-11 sm:min-h-8" onClick={() => void retry(r)} disabled={busyId !== null}>
                          {busyId === r.id ? 'Retrying…' : 'Retry'}
                        </Button>
                        <Button variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => void ignore(r)} disabled={busyId !== null}>Ignore</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && (
          <p className="text-xs text-on-surface-variant">
            Showing {shownRows.length}{shownRows.length !== rows.length ? ` of ${rows.length}` : ''} lead{rows.length === 1 ? '' : 's'}
          </p>
        )}
      </PageBody>
    </>
  );
}
