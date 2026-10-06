'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { useBranding } from '../branding/BrandingProvider';
import { brandNav, filterNav, isNavGroups, isNavItemActive, type NavItem, type NavGroup } from './nav';
import { badgeText, useNavBadges } from './NavBadges';
import { toggleSidebar } from './MobileSidebar';
import NavIcon from './NavIcon';

interface Props {
  actor: SessionUser;
  items: readonly NavItem[] | readonly NavGroup[];
  /**
   * One entry per tab, in order. Each entry lists nav item ids in preference
   * order; the tab shows the first one the actor may open and is dropped when
   * none is openable — e.g. `['bulk-assign', 'assignments']` falls back to
   * Assignments for someone without bulk assign. Ids are the nav item ids, so
   * the same capability filter as the rail applies and a tab can never link
   * somewhere the page would bounce.
   */
  tabs: readonly (readonly string[])[];
}

// Stitch mobile screens: a fixed four-tab bar (Pipeline / Follow-ups /
// Assignment / Analytics) with a "More" entry that opens the drawer, which holds
// everything else. Below lg only — the desktop rail owns navigation there.
export default function MobileTabBar({ actor, items: rawItems, tabs }: Props) {
  const { navOverrides } = useBranding();
  const badges = useNavBadges();
  const pathname = usePathname();

  const picked = useMemo(() => {
    const branded = brandNav(rawItems, navOverrides);
    const flat: readonly NavItem[] = isNavGroups(branded) ? branded.flatMap((g) => g.items) : branded;
    const visible = filterNav(flat, actor);
    const out: NavItem[] = [];
    for (const alternatives of tabs) {
      const hit = alternatives.map((id) => visible.find((i) => i.id === id)).find((i): i is NavItem => !!i);
      if (hit && !out.includes(hit)) out.push(hit);
    }
    return out;
  }, [rawItems, navOverrides, actor, tabs]);

  if (picked.length === 0) return null;

  const base = 'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] font-medium leading-tight transition-colors';

  return (
    <nav
      aria-label="Primary tabs"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-outline-variant bg-surface-container-lowest pb-[env(safe-area-inset-bottom)] shadow-overlay lg:hidden"
    >
      {picked.map((item) => {
        const active = isNavItemActive(item, pathname, picked);
        const count = badges[item.id];
        const showBadge = typeof count === 'number' && count > 0;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            aria-label={showBadge ? `${item.label} (${count})` : item.label}
            className={`${base} ${active ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            <span
              className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                active ? 'bg-primary-container text-on-primary-container' : ''
              }`}
            >
              {item.icon && <NavIcon name={item.icon} className="h-5 w-5" />}
              {showBadge && (
                <span className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-overdue px-1 font-mono text-[0.625rem] font-bold leading-none text-on-status-overdue">
                  {badgeText(count)}
                </span>
              )}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="More navigation"
        className={`${base} text-on-surface-variant hover:text-on-surface`}
      >
        <span className="flex h-7 w-12 items-center justify-center">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </span>
        <span>More</span>
      </button>
    </nav>
  );
}
