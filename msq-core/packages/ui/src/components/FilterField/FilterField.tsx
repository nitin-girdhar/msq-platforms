'use client';

import type { ReactNode } from 'react';

interface Props {
  /** Rendered above the control, in the same style MultiSelect uses for its own. */
  label: string;
  children: ReactNode;
}

/**
 * Label-above-control wrapper for one field in a filter toolbar.
 *
 * It exists so a bare `<input>` sitting beside a `MultiSelect` is the same shape
 * as its neighbours: the MultiSelect renders its own label above a 34px trigger,
 * so an unlabelled input in the same row is a shorter box that never lines up
 * with the dropdowns whatever the row's alignment. Wrap the input in this and
 * align the row `items-end`, and every control shares one baseline.
 */
export default function FilterField({ label, children }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">{label}</span>
      {children}
    </div>
  );
}
