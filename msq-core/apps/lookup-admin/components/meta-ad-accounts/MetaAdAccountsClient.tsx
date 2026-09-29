'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@platform/ui-kit';
import { metaAdAccounts, type MetaAdAccountRow } from '@/src/lib/api/client';

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
}

// Meta returns account_status as a number; 1 is active, anything else is some
// flavour of disabled/closed/in review.
function statusLabel(status: number | null): string {
  if (status === 1) return 'Active';
  if (status === 2) return 'Disabled';
  if (status === 101) return 'Closed';
  return status === null ? '—' : `Status ${status}`;
}

// Ad accounts under the SHARED Meta integration (schema 1.51.0). Platform-level:
// no tenant is selected here, because one account carries campaigns for many
// tenants — "Fetch campaigns" walks the ENABLED accounts and lands each campaign
// in the tenant its promoted pages are mapped to.
export default function MetaAdAccountsClient() {
  const [rows, setRows] = useState<MetaAdAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await metaAdAccounts.list();
      setRows(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load ad accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await metaAdAccounts.sync();
      setRows(res.data.accounts);
      setNotice(`${res.data.seen} account${res.data.seen === 1 ? '' : 's'} visible to the Meta token · ${res.data.added} new (added disabled).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: MetaAdAccountRow, isEnabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await metaAdAccounts.setEnabled(row.ad_account_id, isEnabled);
      setRows((prev) => prev.map((r) => (r.ad_account_id === row.ad_account_id ? res.data : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change was not saved.');
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/m/lms" className="text-xs font-semibold text-[#0b6cbf] hover:underline">← Back to LMS</Link>
          <h1 className="mt-1 text-2xl font-bold text-[#0F172A]">Meta Ad Accounts</h1>
          <p className="mt-1 max-w-3xl text-xs text-[#64748B]">
            Every ad account the shared Meta integration can see. <strong>Fetch campaigns</strong> on Meta Campaign
            Mapping walks the <strong>enabled</strong> ones and files each campaign under the tenant its promoted pages
            are mapped to. Requires <code>ads_read</code> on the token and the system user being assigned the account
            in Business Settings.
          </p>
        </div>
        <Button variant="primary" onClick={sync} disabled={busy} aria-busy={busy}>
          {busy ? 'Syncing…' : 'Sync from Meta'}
        </Button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#334155]">{notice}</div>}

      <div className="overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white">
        <table className="w-full text-xs">
          <thead className="bg-[#F8FAFC] text-left text-[#475569]">
            <tr>
              <th className="px-3 py-2">Walk</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Meta status</th>
              <th className="px-3 py-2">Last campaign fetch</th>
              <th className="px-3 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-4 text-center text-[#64748B]">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-[#64748B]">No ad accounts yet — press Sync from Meta.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.ad_account_id} className="border-t border-[#F1F5F9]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={r.is_enabled}
                    disabled={busy}
                    onChange={(e) => void toggle(r, e.target.checked)}
                    aria-label={`Walk ${r.name ?? r.ad_account_id}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-[#0F172A]">{r.name ?? '—'}</span>
                  <span className="ml-2 font-mono text-[#64748B]">{r.ad_account_id}</span>
                </td>
                <td className="px-3 py-2">{r.business_name ?? '—'}</td>
                <td className="px-3 py-2">{statusLabel(r.account_status)}</td>
                <td className="px-3 py-2">{formatDate(r.last_synced_at)}</td>
                <td className="px-3 py-2">{formatDate(r.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
