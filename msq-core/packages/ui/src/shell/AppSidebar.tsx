'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { filterNav, filterNavGroups, isNavGroups, type NavItem, type NavGroup } from './nav';

interface Props {
  // Carries the DB-resolved capability list that decides which entries appear.
  actor: SessionUser;
  // This product app's nav entries (already product-specific). Filtered here so
  // callers just hand over their full list. A flat NavItem[] renders as today;
  // a NavGroup[] renders each group under its own heading (e.g. per module).
  items: readonly NavItem[] | readonly NavGroup[];
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-lg bg-[#EFF6FF] px-3 py-2 text-sm font-semibold text-[#0b6cbf]'
          : 'rounded-lg px-3 py-2 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A]'
      }
    >
      {item.label}
    </Link>
  );
}

// Desktop left rail, shared across every product app. Product-agnostic: the
// entries come entirely from `items`.
export default function AppSidebar({ actor, items }: Props) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-[#E2E8F0] bg-white lg:flex">
      <nav className="flex flex-col gap-1 overflow-y-auto p-4" aria-label="Primary">
        {isNavGroups(items) ? (
          filterNavGroups(items, actor).map((group) => (
            <div key={group.id} className="flex flex-col gap-1 pb-3">
              <span className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
                {group.label}
              </span>
              {group.items.map((item) => (
                <NavLink key={item.id} item={item} pathname={pathname} />
              ))}
            </div>
          ))
        ) : (
          filterNav(items, actor).map((item) => (
            <NavLink key={item.id} item={item} pathname={pathname} />
          ))
        )}
      </nav>
    </aside>
  );
}
