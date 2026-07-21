import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  /** Tab strip (PageTabs) — rendered as the band's first row, full-bleed. */
  tabs?: ReactNode;
  /** Primary/secondary actions, right-aligned on the title row. */
  actions?: ReactNode;
}

// The chrome band that opens every product page. Mirrors the LMS dashboard's
// structure: full-bleed white bands separated by a single edge-to-edge rule,
// with the page gutter (`px-4 sm:px-5`) applied to the band's *content* only.
// Nesting the tab strip inside a padded page container — which HR and Tasks
// used to do — leaves its border-b floating short of both the sidebar rule and
// the right edge, which is the single biggest reason those pages read as
// unfinished next to LMS.
export default function PageHeader({ title, subtitle, tabs, actions }: Props) {
  return (
    <header className="shrink-0 border-b border-[#E2E8F0] bg-white">
      {tabs && <div className="px-4 sm:px-5">{tabs}</div>}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold tracking-tight text-[#0F172A]">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-xs text-[#64748B]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
