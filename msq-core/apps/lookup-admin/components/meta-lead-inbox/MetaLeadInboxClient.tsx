'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@platform/ui-kit';
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
}

// Webhook leads that did NOT become an LMS lead (schema 1.51.0). They used to be
// a log line only, and Meta never redelivers them because the webhook answers
// 200 regardless. Fix the cause (usually: map the page on Meta Page Mapping),
// then Retry — the lead goes through the same write path as the webhook, so it
// is typed and assigned exactly as if it had arrived normally.
export default function MetaLeadInboxClient({ tenantId }: Props) {
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

  const select = 'rounded-lg border border-[#E2E8F0] bg-white px-2 py-1 text-xs';

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">← Back to LMS</Link>
        <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">Meta Lead Inbox</h1>
        <p className="mt-1 max-w-3xl text-xs text-[#64748B]">
          Leads Meta delivered that could not be created. Fix the cause — for an unmapped page, map it on{' '}
          <Link href="/dashboard/meta-mappings" className="font-semibold text-[#0b6cbf] hover:underline">Meta Page Mapping</Link>{' '}
          — then Retry. A retried lead is typed and assigned exactly as a live one.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'tenant' | 'unowned')} aria-label="Inbox scope" className={select}>
          <option value="tenant" disabled={!tenantId}>Selected tenant{tenantId ? '' : ' (pick one in the top bar)'}</option>
          <option value="unowned">Pages mapped to no tenant</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as InboxStatus)} aria-label="Inbox status" className={select}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}

      <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white">
        <table className="w-full text-xs">
          <thead className="bg-[#F8FAFC] text-left text-[#475569]">
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
            {loading && <tr><td colSpan={6} className="px-3 py-4 text-center text-[#64748B]">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-[#64748B]">Nothing here.</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-[#F1F5F9] align-top">
                <td className="px-3 py-2">{formatDate(r.lead_created_at ?? r.created_at)}</td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-[#0F172A]">{r.lead_name ?? '—'}</span>
                  <span className="block font-mono text-[#64748B]">{r.meta_lead_id}</span>
                </td>
                <td className="px-3 py-2">
                  {REASON_LABELS[r.reason]}
                  {r.error_text && <span className="block text-[#64748B]">{r.error_text}</span>}
                </td>
                <td className="px-3 py-2 font-mono text-[#64748B]">
                  {r.page_id ?? '—'}
                  <span className="block">{r.form_id ?? ''}</span>
                </td>
                <td className="px-3 py-2">{r.attempts}</td>
                <td className="space-x-1 px-3 py-2 text-right">
                  {r.status === 'open' && (
                    <>
                      <Button variant="primary" onClick={() => void retry(r)} disabled={busyId !== null}>
                        {busyId === r.id ? 'Retrying…' : 'Retry'}
                      </Button>
                      <Button variant="secondary" onClick={() => void ignore(r)} disabled={busyId !== null}>Ignore</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
