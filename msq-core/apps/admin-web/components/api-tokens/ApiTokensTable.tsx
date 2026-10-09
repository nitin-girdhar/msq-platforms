'use client';

import { useMemo, useState } from 'react';
import { LocalDateTime } from '@platform/ui-kit';
import type { ApiTokenRow } from '@/src/lib/api/client';

interface OrgOption {
  id: string;
  name: string;
}

interface Props {
  tokens: ApiTokenRow[];
  orgs: OrgOption[];
  canManage: boolean;
  onEdit: (token: ApiTokenRow) => void;
  onRotate: (token: ApiTokenRow) => void;
  onRevoke: (token: ApiTokenRow) => void;
}

type StatusKey = 'active' | 'revoked' | 'expired' | 'inactive';
type StatusFilter = 'all' | StatusKey;

const STATUS_STYLE: Record<StatusKey, { label: string; className: string; dot: string }> = {
  revoked: { label: 'Revoked', className: 'bg-status-overdue-container text-on-status-overdue-container', dot: 'bg-status-overdue' },
  expired: { label: 'Expired', className: 'bg-status-due-container text-on-status-due-container', dot: 'bg-status-due' },
  inactive: { label: 'Inactive', className: 'bg-surface-container text-on-surface-variant', dot: 'bg-outline' },
  active: { label: 'Active', className: 'bg-status-success-container text-on-status-success-container', dot: 'bg-status-success' },
};

function statusKeyOf(token: ApiTokenRow): StatusKey {
  if (token.revoked_at) return 'revoked';
  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) return 'expired';
  if (!token.is_active) return 'inactive';
  return 'active';
}

function branchLabel(token: ApiTokenRow, orgs: OrgOption[]): string {
  if (token.scope_all_orgs) return 'All branches (tenant-wide)';
  if (token.org_ids.length === 0) return '—';
  const names = token.org_ids.map((id) => orgs.find((o) => o.id === id)?.name ?? id);
  return names.join(', ');
}

function StatusPill({ token }: { token: ApiTokenRow }) {
  const s = STATUS_STYLE[statusKeyOf(token)];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

function ScopeChips({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) return <span className="text-on-surface-variant">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((sc) => (
        <span key={sc} className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[0.6875rem] text-on-surface-variant">
          {sc}
        </span>
      ))}
    </div>
  );
}

function KeyPill({ prefix }: { prefix: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-2 py-1 font-mono text-xs text-on-surface-variant">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="m10.7 12.3 9.3-9.3M16 7l3 3" />
      </svg>
      {prefix}…
    </span>
  );
}

const ROW_BTN =
  'rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50';
const ROW_BTN_DANGER =
  'rounded-lg border border-status-overdue/30 bg-surface-container-lowest px-3 py-1 text-xs font-semibold text-on-status-overdue-container hover:bg-status-overdue-container disabled:cursor-not-allowed disabled:opacity-50';

const CHIPS: StatusFilter[] = ['all', 'active', 'revoked', 'expired', 'inactive'];

export default function ApiTokensTable({ tokens, orgs, canManage, onEdit, onRotate, onRevoke }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: tokens.length, active: 0, revoked: 0, expired: 0, inactive: 0 };
    for (const t of tokens) c[statusKeyOf(t)] += 1;
    return c;
  }, [tokens]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tokens.filter((t) => {
      if (status !== 'all' && statusKeyOf(t) !== status) return false;
      if (!q) return true;
      return `${t.name} ${t.key_prefix} ${t.scopes.join(' ')} ${branchLabel(t, orgs)}`.toLowerCase().includes(q);
    });
  }, [tokens, orgs, query, status]);

  if (tokens.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-on-surface-variant">
        No API tokens yet.
      </div>
    );
  }

  const actions = (t: ApiTokenRow, mobile: boolean) => {
    const revoked = !!t.revoked_at;
    const size = mobile ? ' min-h-[2.75rem] px-4' : '';
    return (
      <>
        <button type="button" onClick={() => onEdit(t)} disabled={revoked} className={ROW_BTN + size}>Edit</button>
        <button type="button" onClick={() => onRotate(t)} disabled={revoked} className={ROW_BTN + size}>Rotate</button>
        <button type="button" onClick={() => onRevoke(t)} disabled={revoked} className={ROW_BTN_DANGER + size}>Revoke</button>
      </>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, key, scope…"
          aria-label="Filter tokens"
          className="h-[2.75rem] w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:h-[34px] sm:max-w-sm"
        />
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Status filter">
          {CHIPS.filter((c) => c === 'all' || counts[c] > 0).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={status === c}
              onClick={() => setStatus(c)}
              className={`min-h-[2.75rem] shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5 ${
                status === c
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              {c === 'all' ? 'All' : STATUS_STYLE[c].label} ({counts[c]})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-on-surface-variant">
          No tokens match the filter.
        </div>
      )}

      {/* Phones and tablets: one card per token. */}
      <ul className="space-y-3 lg:hidden">
        {visible.map((t) => (
          <li key={t.id} className="space-y-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-on-surface">{t.name}</p>
                <p className="mt-0.5 text-xs text-on-surface-variant">{branchLabel(t, orgs)}</p>
              </div>
              <StatusPill token={t} />
            </div>
            <KeyPill prefix={t.key_prefix} />
            <div>
              <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-on-surface-variant">Granted scopes</p>
              <ScopeChips scopes={t.scopes} />
            </div>
            <p className="text-xs text-on-surface-variant">
              Last used: <LocalDateTime value={t.last_used_at} fallback="Never" options={{ dateStyle: 'medium', timeStyle: 'short' }} />
            </p>
            {canManage && <div className="flex flex-wrap justify-end gap-2">{actions(t, true)}</div>}
          </li>
        ))}
      </ul>

      {/* Desktop: table. */}
      {visible.length > 0 && (
        <div className="hidden overflow-hidden overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm lg:block">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Branches</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last used</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} className="border-b border-surface-container align-top last:border-0 hover:bg-surface-container-low">
                  <td className="px-4 py-3 font-semibold text-on-surface">{t.name}</td>
                  <td className="px-4 py-3"><KeyPill prefix={t.key_prefix} /></td>
                  <td className="px-4 py-3 text-xs"><ScopeChips scopes={t.scopes} /></td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">{branchLabel(t, orgs)}</td>
                  <td className="px-4 py-3"><StatusPill token={t} /></td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    <LocalDateTime value={t.last_used_at} fallback="Never" options={{ dateStyle: 'medium', timeStyle: 'short' }} />
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">{actions(t, false)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
