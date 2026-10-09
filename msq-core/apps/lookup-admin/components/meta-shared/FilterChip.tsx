import type { ReactNode } from 'react';

// A pressed/unpressed filter chip. Used inside a `role="group"` segmented strip
// (Lead Review Inbox status) -- keep `aria-pressed`, not `role="tab"`, here.
export default function FilterChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center px-3 text-xs font-semibold transition-colors sm:min-h-8 ${
        on ? 'bg-primary-fixed text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-low'
      }`}
    >
      {children}
    </button>
  );
}
