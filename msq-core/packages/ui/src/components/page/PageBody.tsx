import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  /** Tighter rhythm for data-heavy console screens: smaller gutters, 0.75rem
   *  between blocks, less padding under the last one. Off by default so product
   *  pages that have not been reviewed keep their current spacing. */
  dense?: boolean;
}

// Scrollable content region below PageHeader. Gutters match the header band and
// the navbar (`px-4 sm:px-5`) so the whole column shares one left edge; `pb-8`
// keeps the last card off the fold, which the old `py-4` did not. `dense` trades
// that air for rows on screen (Super Admin consoles).
export default function PageBody({ children, className = '', dense = false }: Props) {
  const rhythm = dense ? 'space-y-3 px-3 pb-4 pt-3 sm:px-4' : 'space-y-5 px-4 pb-8 pt-4 sm:px-5';
  return (
    <div className={`w-full flex-1 ${rhythm} ${className}`}>
      {children}
    </div>
  );
}
