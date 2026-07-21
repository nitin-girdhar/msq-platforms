import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

// Scrollable content region below PageHeader. Gutters match the header band and
// the navbar (`px-4 sm:px-5`) so the whole column shares one left edge; `pb-8`
// keeps the last card off the fold, which the old `py-4` did not.
export default function PageBody({ children, className = '' }: Props) {
  return (
    <div className={`w-full flex-1 space-y-5 px-4 pb-8 pt-4 sm:px-5 ${className}`}>
      {children}
    </div>
  );
}
