'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, PageBody, PageHeader } from '@platform/ui-kit';
import Link from 'next/link';
import { metaAdAccounts, type MetaAdAccountRow, type MetaTokenPermissions } from '@/src/lib/api/client';
import MetaTabs from '@/components/meta-nav/MetaTabs';

type Filter = 'all' | 'enabled' | 'disabled' | 'errors';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All Accounts' },
  { id: 'enabled', label: 'Walk Enabled' },
  { id: 'disabled', label: 'Disabled' },
  { id: 'errors', label: 'With Errors' },
];

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

function statusTone(status: number | null): string {
  if (status === 1) return 'bg-status-success-container text-on-status-success-container';
  if (status === null) return 'bg-surface-container text-on-surface-variant';
  return 'bg-error-container text-on-error-container';
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
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [token, setToken] = useState<MetaTokenPermissions | null>(null);

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

  const bulk = async (isEnabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await metaAdAccounts.setEnabledBulk([...selected], isEnabled);
      setRows(res.data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change was not saved.');
      void load();
    } finally {
      setBusy(false);
    }
  };

  const checkToken = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await metaAdAccounts.tokenPermissions();
      setToken(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the Meta token.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const enabledCount = useMemo(() => rows.filter((r) => r.is_enabled).length, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'enabled' && !r.is_enabled) return false;
      if (filter === 'disabled' && r.is_enabled) return false;
      if (filter === 'errors' && !r.last_error) return false;
      if (!q) return true;
      return [r.name, r.ad_account_id, r.business_name].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const errorCount = useMemo(() => rows.filter((r) => r.last_error).length, [rows]);

  const countFor = (id: Filter): number =>
    id === 'all' ? rows.length
      : id === 'enabled' ? enabledCount
      : id === 'disabled' ? rows.length - enabledCount
      : errorCount;

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.ad_account_id));

  return (
    <>
      <PageHeader
        title="Meta Ad Accounts"
        subtitle="Every ad account the shared Meta integration can see"
        tabs={<MetaTabs />}
        actions={
          <>
            <Button onClick={checkToken} disabled={busy}>Check token permissions</Button>
            <Button variant="primary" onClick={sync} disabled={busy} aria-busy={busy}>
              {busy ? 'Working…' : 'Sync from Meta'}
            </Button>
          </>
        }
      />
      <PageBody>
        <p className="max-w-3xl text-xs text-on-surface-variant">
          <strong className="text-on-surface">Fetch campaigns</strong> on Meta Campaign Mapping walks the{' '}
          <strong className="text-on-surface">enabled</strong> accounts and files each campaign under the tenant
          its promoted pages are mapped to. Requires <code className="font-mono">ads_read</code> on the token and
          the system user being assigned the account in Business Settings.
        </p>

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {token && (
          <section aria-label="Meta token permissions" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-on-surface">Shared Meta token</span>
              <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${token.is_valid ? 'bg-status-success-container text-on-status-success-container' : 'bg-error-container text-on-error-container'}`}>
                {token.is_valid ? 'Valid' : 'Invalid'}
              </span>
              <span className="text-on-surface-variant">
                {token.expires_at ? `Expires ${formatDate(token.expires_at)}` : 'Does not expire'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {token.scopes.map((sc) => (
                <span key={sc} className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[0.6875rem] text-on-surface-variant">{sc}</span>
              ))}
            </div>
            {token.missing.length > 0 && (
              <p className="mt-2 font-medium text-error">
                Missing: <span className="font-mono">{token.missing.join(', ')}</span> — the pipeline needs these.
              </p>
            )}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search account name, ID or business…"
            aria-label="Search ad accounts"
            className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none sm:max-w-sm"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter accounts">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f.id
                    ? 'border-primary bg-primary-fixed text-primary'
                    : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {f.label} ({countFor(f.id)})
              </button>
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-fixed px-3 py-2 text-xs">
            <span className="font-semibold text-primary">{selected.size} account{selected.size === 1 ? '' : 's'} selected</span>
            <Button size="sm" disabled={busy} onClick={() => void bulk(true)}>Enable walk</Button>
            <Button size="sm" disabled={busy} onClick={() => void bulk(false)}>Disable walk</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-xs">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((r) => r.ad_account_id)) : new Set())}
                    aria-label="Select all shown accounts"
                    className="accent-primary"
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Walk</th>
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold">Business</th>
                <th className="px-3 py-2 font-semibold">Meta status</th>
                <th className="px-3 py-2 font-semibold">Last campaign fetch</th>
                <th className="px-3 py-2 font-semibold">Fetch result</th>
                <th className="px-3 py-2 font-semibold">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-3 py-4 text-center text-on-surface-variant">Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-4 text-center text-on-surface-variant">No ad accounts yet — press Sync from Meta.</td></tr>
              )}
              {!loading && rows.length > 0 && visible.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-4 text-center text-on-surface-variant">No accounts match this filter.</td></tr>
              )}
              {visible.map((r) => (
                <tr key={r.ad_account_id} className="border-t border-outline-variant">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.ad_account_id)}
                      onChange={(e) => toggleSelected(r.ad_account_id, e.target.checked)}
                      aria-label={`Select ${r.name ?? r.ad_account_id}`}
                      className="accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={r.is_enabled}
                      disabled={busy}
                      onChange={(e) => void toggle(r, e.target.checked)}
                      aria-label={`Walk ${r.name ?? r.ad_account_id}`}
                      className="accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-on-surface">{r.name ?? '—'}</span>
                    <span className="ml-2 font-mono text-on-surface-variant">{r.ad_account_id}</span>
                  </td>
                  <td className="px-3 py-2 text-on-surface">{r.business_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${statusTone(r.account_status)}`}>
                      {statusLabel(r.account_status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-on-surface-variant">{formatDate(r.last_synced_at)}</td>
                  <td className="max-w-[16rem] px-3 py-2">
                    {r.last_error ? (
                      <span className="text-error" title={r.last_error}>
                        <span className="block truncate">{r.last_error}</span>
                        <span className="text-[0.6875rem] text-on-surface-variant">{formatDate(r.last_error_at)}</span>
                      </span>
                    ) : r.last_synced_at ? (
                      <span className="text-on-status-success-container">OK</span>
                    ) : (
                      <span className="text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-on-surface-variant">{formatDate(r.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-on-surface-variant">
          Showing {visible.length} of {rows.length} ad account{rows.length === 1 ? '' : 's'} · {enabledCount} enabled for campaign walks.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
          <p className="text-xs text-on-surface-variant">
            Accounts enabled? Pull any leads the webhook missed, then map pages to branches.
          </p>
          <div className="flex gap-2">
            <Link href="/dashboard/lead-pull" className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container">
              Trigger Lead Pull
            </Link>
            <Link href="/dashboard/meta-mappings" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary hover:bg-primary/90">
              Next: Page &amp; Branch Mapping
            </Link>
          </div>
        </div>
      </PageBody>
    </>
  );
}
