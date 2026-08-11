// The form control vocabulary these screens already use, named once so the new
// fields sit flush with the hand-written ones in each modal rather than
// approximating them. Values match CreateUserModal.tsx / EditUserModal.tsx.

export const FIELD_LABEL = 'text-xs font-semibold text-[#0F172A]';

export const FIELD_BASE =
  'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm ' +
  'focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 ' +
  'disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

/** Compact variant for controls inside the per-branch table rows. */
export const FIELD_SM =
  'rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[13px] text-[#0F172A] ' +
  'focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 ' +
  'disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

export const HINT = 'text-[11px] text-[#64748B]';
