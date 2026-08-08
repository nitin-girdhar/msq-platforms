'use client';

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

function statusOf(token: ApiTokenRow): { label: string; className: string } {
  if (token.revoked_at) return { label: 'Revoked', className: 'bg-slate-100 text-slate-500' };
  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) {
    return { label: 'Expired', className: 'bg-amber-50 text-amber-700' };
  }
  if (!token.is_active) return { label: 'Inactive', className: 'bg-slate-100 text-slate-500' };
  return { label: 'Active', className: 'bg-emerald-50 text-emerald-700' };
}

function branchLabel(token: ApiTokenRow, orgs: OrgOption[]): string {
  if (token.scope_all_orgs) return 'All branches (tenant-wide)';
  if (token.org_ids.length === 0) return '—';
  const names = token.org_ids.map((id) => orgs.find((o) => o.id === id)?.name ?? id);
  return names.join(', ');
}

export default function ApiTokensTable({ tokens, orgs, canManage, onEdit, onRotate, onRevoke }: Props) {
  if (tokens.length === 0) {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#64748B]">
        No API tokens yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold uppercase tracking-wide text-[#64748B]">
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
          {tokens.map((t) => {
            const status = statusOf(t);
            const revoked = !!t.revoked_at;
            return (
              <tr key={t.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                <td className="px-4 py-3 font-semibold text-[#0F172A]">{t.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#64748B]">{t.key_prefix}…</td>
                <td className="px-4 py-3 text-xs text-[#64748B]">{t.scopes.join(', ')}</td>
                <td className="px-4 py-3 text-xs text-[#64748B]">{branchLabel(t, orgs)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                    {status.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[#64748B]">
                  {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'Never'}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(t)}
                        disabled={revoked}
                        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onRotate(t)}
                        disabled={revoked}
                        className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Rotate
                      </button>
                      <button
                        type="button"
                        onClick={() => onRevoke(t)}
                        disabled={revoked}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
