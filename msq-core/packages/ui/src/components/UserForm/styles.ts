// The form control vocabulary these screens already use, named once so the new
// fields sit flush with the hand-written ones in each modal rather than
// approximating them. Values match CreateUserModal.tsx / EditUserModal.tsx.

export const FIELD_LABEL = 'text-xs font-semibold text-on-surface';

export const FIELD_BASE =
  'rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface shadow-sm ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-container-low';

/** Compact variant for controls inside the per-branch table rows. */
export const FIELD_SM =
  'rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-[0.8125rem] text-on-surface ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-container-low';

export const HINT = 'text-[0.6875rem] text-on-surface-variant';
