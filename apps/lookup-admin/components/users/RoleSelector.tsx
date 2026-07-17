'use client';

import { ROLES, ROLE_LABELS } from '@crm/auth-constants';
import type { UserRole } from '@crm/types';

interface Props {
  id: string;
  value: UserRole;
  onChange: (role: UserRole) => void;
  disabled?: boolean;
  label?: string;
}

// Unlike apps/web's RoleSelector, this app is entirely super_admin-gated
// (see app/dashboard/layout.tsx), so every role is always assignable — no
// actorRank-based filtering of the option list.
export default function RoleSelector({ id, value, onChange, disabled, label = 'Role' }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[#0F172A]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as UserRole)}
        disabled={disabled}
        className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </div>
  );
}
