'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { useBranding } from '../branding/BrandingProvider';
import { brandNav, filterNav, filterNavGroups, isNavGroups, isNavItemActive, type NavItem, type NavGroup } from './nav';
import NavIcon from './NavIcon';
import BrandMark, { type ShellBrand } from './BrandMark';
import { badgeText, useNavBadges } from './NavBadges';

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
  // Logo + product name at the top of the rail (Stitch layout: the rail runs
  // full height and owns the brand; the navbar beside it does not repeat it).
  // Omitted by callers that still stack the navbar above the rail.
  brand?: ShellBrand;
  // Optional count per nav item id (e.g. LMS overdue follow-ups). Rendered as a
  // status-overdue pill; 0/undefined renders nothing. Purely informational.
  // Falls back to the NavBadgesProvider value when not passed directly.
  badges?: Readonly<Record<string, number>>;
  // Optional product block between the nav and the Collapse button (HR's working-time and shift cards). Hidden
  // while the rail is collapsed, which has no room for it. Omitted = nothing, so other products are unchanged.
  footerSlot?: React.ReactNode;
}

// Collapsed rail has no room for the label: it shows the entry's icon, or — for
// an entry that declares none — its initials, "Leads History" → "LH".
function monogram(label: string): string {
  return label
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

function NavBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  const text = badgeText(count);
  return collapsed ? (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-overdue px-1 font-mono text-[0.625rem] font-bold leading-none text-on-status-overdue">
      {text}
    </span>
  ) : (
    <span className="ml-auto rounded-full bg-status-overdue-container px-1.5 py-0.5 font-mono text-[0.6875rem] font-bold leading-none text-on-status-overdue-container">
      {text}
    </span>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  badge,
  all,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  badge?: number | undefined;
  /** Every entry in the rail, so the most specific match is the one that lights up. */
  all: readonly NavItem[];
}) {
  const active = isNavItemActive(item, pathname, all);
  const showBadge = typeof badge === 'number' && badge > 0;

  if (collapsed) {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={showBadge ? `${item.label} (${badge})` : item.label}
        title={item.label}
        className={`relative flex h-10 w-10 items-center justify-center self-center rounded-lg text-xs font-semibold tracking-tight transition-colors ${
          active
            ? 'bg-primary-container text-on-primary-container shadow-card'
            : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
        }`}
      >
        {item.icon ? <NavIcon name={item.icon} className="h-5 w-5" /> : monogram(item.label)}
        {showBadge && <NavBadge count={badge} collapsed />}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-body-md transition-colors ${
        active
          ? 'bg-primary-container font-semibold text-on-primary-container shadow-card'
          : 'font-medium text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
      }`}
    >
      {item.icon && <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />}
      <span className="truncate">{item.label}</span>
      {showBadge && <NavBadge count={badge} collapsed={false} />}
    </Link>
  );
}

// Desktop left rail, shared across every product app. Product-agnostic: the
// entries come entirely from `items`. Collapses to an icon-width rail so wide
// screens (grids, stat cards) get the extra ~12rem back.
export default function AppSidebar({ actor, items: rawItems, brand, badges: badgesProp, footerSlot }: Props) {
  const ctxBadges = useNavBadges();
  const badges = badgesProp ?? ctxBadges;
  const { navOverrides } = useBranding();
  const items = useMemo(() => brandNav(rawItems, navOverrides), [rawItems, navOverrides]);
  const pathname = usePathname();
  const allItems = useMemo<readonly NavItem[]>(() => (isNavGroups(items) ? items.flatMap((g) => g.items) : items), [items]);
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

  // Ctrl/⌘+B toggles the rail (Stitch "Expand Navigation (Ctrl + B)"). Ignored
  // while typing so it never steals bold-text shortcuts from an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b' || e.altKey || e.shiftKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setCollapsed((prev) => {
        const next = !prev;
        try {
          window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
        } catch {
          // Not persisted; still toggles.
        }
        return next;
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside
      className={`z-20 hidden shrink-0 flex-col bg-surface-container-lowest shadow-card transition-[width] duration-200 ease-out lg:flex ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {brand && (
        <div className={`flex h-16 shrink-0 items-center ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
          <BrandMark brand={brand} compact={collapsed} />
        </div>
      )}

      <nav
        className={`flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden ${collapsed ? 'px-3 py-2' : 'px-4 py-2'}`}
        aria-label="Primary"
      >
        {isNavGroups(items) ? (
          filterNavGroups(items, actor).map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5 pb-3">
              {collapsed ? (
                <span aria-hidden="true" className="mx-auto my-2 h-px w-6 bg-outline-variant" />
              ) : (
                <span className="px-3 pb-1 pt-2 text-label-sm uppercase tracking-wider text-outline">
                  {group.label}
                </span>
              )}
              {group.items.map((item) => (
                <NavLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} badge={badges?.[item.id]} all={allItems} />
              ))}
            </div>
          ))
        ) : (
          filterNav(items, actor).map((item) => (
            <NavLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} badge={badges?.[item.id]} all={allItems} />
          ))
        )}
      </nav>

      {!collapsed && footerSlot && <div className="shrink-0 px-4 pb-1">{footerSlot}</div>}

      <div className={`shrink-0 ${collapsed ? 'flex justify-center p-3' : 'px-4 py-3'}`}>
        <button
          type="button"
          onClick={() => apply(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation (Ctrl + B)' : 'Collapse navigation (Ctrl + B)'}
          className={`flex items-center gap-2 rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface ${
            collapsed ? 'h-10 w-10 justify-center' : 'w-full px-3 py-2'
          }`}
        >
          <svg
            className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {!collapsed && <span className="text-label-md">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
