'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { filterNav, type NavItem } from './nav';

interface Props {
  // Carries the DB-resolved capability list that decides which entries appear.
  actor: SessionUser;
  // This product app's nav entries (already product-specific). Filtered here so
  // callers just hand over their full list.
  items: readonly NavItem[];
}

// Desktop left rail, shared across every product app. Product-agnostic: the
// entries come entirely from `items`.
export default function AppSidebar({ actor, items }: Props) {
  const pathname = usePathname();
  const visible = filterNav(items, actor);

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-[#E2E8F0] bg-white lg:flex">
      <nav className="flex flex-col gap-1 p-4" aria-label="Primary">
        {visible.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.id}
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
        })}
      </nav>
    </aside>
  );
}
