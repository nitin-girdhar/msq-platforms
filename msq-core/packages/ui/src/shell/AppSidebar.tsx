'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { filterNav, filterNavGroups, isNavGroups, type NavItem, type NavGroup } from './nav';

// Remembered per browser so the rail does not spring back open on every
// navigation. Read after mount — reading during render would make the server
// HTML and the first client render disagree.
const STORAGE_KEY = 'fc:sidebar-collapsed';

interface Props {
  // Carries the DB-resolved capability list that decides which entries appear.
  actor: SessionUser;
  // This product app's nav entries (already product-specific). Filtered here so
  // callers just hand over their full list. A flat NavItem[] renders as today;
  // a NavGroup[] renders each group under its own heading (e.g. per module).
  items: readonly NavItem[] | readonly NavGroup[];
}

// Collapsed rail has no room for the label, so each entry falls back to its
// initials — "Leads History" → "LH".
function monogram(label: string): string {
  return label
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

function NavLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  if (collapsed) {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        title={item.label}
        className={
          active
            ? 'flex h-9 w-9 items-center justify-center self-center rounded-lg bg-[#EFF6FF] text-xs font-bold tracking-tight text-[#0b6cbf]'
            : 'flex h-9 w-9 items-center justify-center self-center rounded-lg text-xs font-semibold tracking-tight text-[#64748B] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A]'
        }
      >
        {monogram(item.label)}
      </Link>
    );
  }

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
// entries come entirely from `items`. Collapses to an icon-width rail so wide
// screens (grids, stat cards) get the extra ~10rem back.
export default function AppSidebar({ actor, items }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // Private-mode / blocked storage: keep the default expanded rail.
    }
  }, []);

  const apply = (next: boolean) => {
    setCollapsed((prev) => {
      if (prev === next) return prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Preference just does not persist; the rail still toggles.
      }
      return next;
    });
  };

  // Working in the content — the grid, the cards, the toolbar — folds the rail
  // out of the way on its own; the collapse button is only needed to bring it
  // back. Desktop only: below `lg` this aside is display:none and the drawer in
  // MobileSidebar owns navigation.
  useEffect(() => {
    const onPointerDown = (e: Event) => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('main')) return;
      apply(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r border-[#E2E8F0] bg-white transition-[width] duration-200 ease-out lg:flex ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      <nav
        className={`flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden ${collapsed ? 'p-2' : 'p-4'}`}
        aria-label="Primary"
      >
        {isNavGroups(items) ? (
          filterNavGroups(items, actor).map((group) => (
            <div key={group.id} className="flex flex-col gap-1 pb-3">
              {collapsed ? (
                <span aria-hidden="true" className="mx-auto my-1.5 h-px w-6 bg-[#E2E8F0]" />
              ) : (
                <span className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
                  {group.label}
                </span>
              )}
              {group.items.map((item) => (
                <NavLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
              ))}
            </div>
          ))
        ) : (
          filterNav(items, actor).map((item) => (
            <NavLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
          ))
        )}
      </nav>

      <div className={`shrink-0 border-t border-[#E2E8F0] ${collapsed ? 'p-2' : 'px-4 py-3'}`}>
        <button
          type="button"
          onClick={() => apply(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className={`flex items-center gap-2 rounded-lg text-[#64748B] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A] ${
            collapsed ? 'h-9 w-9 justify-center self-center' : 'w-full px-3 py-2'
          }`}
        >
          <svg
            className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {!collapsed && <span className="text-sm font-medium">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
