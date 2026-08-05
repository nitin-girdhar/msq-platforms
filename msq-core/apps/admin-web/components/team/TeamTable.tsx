'use client';

import type { SessionUser } from '@platform/types';
import UserStatusBadge from './UserStatusBadge';

interface Props {
  users: SessionUser[];
  currentUserId: string;
  onEdit: (user: SessionUser) => void;
}

function displayName(u: SessionUser): string {
  return (u.name || [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ')).trim();
}

export default function TeamTable({ users, currentUserId, onEdit }: Props) {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#64748B]">
        No team members found.
      </div>
    );
  }

  return (
    <div className="overflow-hidden overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold uppercase tracking-wide text-[#64748B]">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
              <td className="px-4 py-3">
                <p className="font-semibold leading-tight text-[#0F172A]">
                  {displayName(u) || '—'}
                  {u.id === currentUserId && (
                    <span className="ml-2 text-[10px] font-semibold uppercase text-[#0b6cbf]">(you)</span>
                  )}
                </p>
                {u.role_label && <p className="text-[11px] leading-tight text-[#64748B]">{u.role_label}</p>}
              </td>
              <td className="px-4 py-3 text-[#0F172A]">{u.email}</td>
              <td className="px-4 py-3 text-[#0F172A]">{u.role_label || u.role}</td>
              <td className="px-4 py-3">
                <UserStatusBadge active={u.is_active} />
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(u)}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
