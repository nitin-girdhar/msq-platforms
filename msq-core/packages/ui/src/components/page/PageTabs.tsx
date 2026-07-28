'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface PageTab {
  href: string;
  label: string;
  /** Exact-match only — for a section root like `/leave` that would otherwise
   *  swallow every child route. */
  exact?: boolean;
  /** Count of items awaiting the user on that tab. Rendered as a pill; omitted
   *  or 0 renders nothing, so a caller can pass a count unconditionally. */
  badge?: number;
}

interface Props {
  tabs: readonly PageTab[];
  label: string;
}

// In-page sub-navigation, shared by every product. The active underline sits on
// the header band's own bottom rule (`-mb-px` against PageHeader's border-b), so
// the rule runs edge to edge and the tab simply interrupts it.
export default function PageTabs({ tabs, label }: Props) {
  const pathname = usePathname();

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-hide" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'shrink-0 border-b-2 border-[#0b6cbf] px-3 py-2 text-sm font-semibold text-[#0b6cbf]'
                : 'shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-[#64748B] transition-colors hover:text-[#0F172A]'
            }
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span
                // Amber rather than the active blue: this is "something needs
                // you", which must read the same whether the tab is selected.
                className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-800"
                // Without this the tab announces as "Team 3", which says nothing
                // about what the 3 is.
                aria-label={`${tab.badge} awaiting your attention`}
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
