'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@platform/types';
import { useBranding } from '../branding/BrandingProvider';
import { brandNav, filterNav, filterNavGroups, isNavGroups, type NavItem, type NavGroup } from './nav';
import NavIcon from './NavIcon';
import BrandMark, { type ShellBrand } from './BrandMark';
import { badgeText, useNavBadges } from './NavBadges';

const TOGGLE_EVENT = 'fc:sidebar-toggle';
const SET_EVENT = 'fc:sidebar-set';

// Fired by HamburgerButton (which lives in the navbar, a separate subtree) to
// open the drawer without a shared React context. Cross-app-safe: same event
// names in every product image.
export function toggleSidebar(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
}

function setSidebar(open: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SET_EVENT, { detail: open }));
}

interface Props {
  // Carries the DB-resolved capability list that decides which entries appear.
  actor: SessionUser;
  items: readonly NavItem[] | readonly NavGroup[];
  // Brand block in the drawer header; omitted → the plain "Workspace" heading.
  brand?: ShellBrand | undefined;
}

function MobileNavLink({ item, pathname, badge }: { item: NavItem; pathname: string; badge?: number | undefined }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'flex items-center gap-3 rounded-lg bg-primary-container px-3 py-2.5 text-body-md font-semibold text-on-primary-container shadow-card'
          : 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-body-md font-medium text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface'
      }
    >
      {item.icon && <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />}
      <span className="truncate">{item.label}</span>
      {showBadge && (
        <span className="ml-auto rounded-full bg-status-overdue-container px-1.5 py-0.5 font-mono text-[11px] font-bold leading-none text-on-status-overdue-container">
          {badgeText(badge)}
        </span>
      )}
    </Link>
  );
}

// Mobile slide-over nav, shared across product apps. Same product-agnostic
// contract as AppSidebar.
export default function MobileSidebar({ actor, items: rawItems, brand }: Props) {
  const { navOverrides } = useBranding();
  const items = useMemo(() => brandNav(rawItems, navOverrides), [rawItems, navOverrides]);
  const badges = useNavBadges();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const grouped = isNavGroups(items);
  const flatVisible = grouped ? [] : filterNav(items, actor);
  const groupsVisible = grouped ? filterNavGroups(items, actor) : [];

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onSet = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setOpen(!!detail);
    };
    window.addEventListener(TOGGLE_EVENT, onToggle);
    window.addEventListener(SET_EVENT, onSet);
    return () => {
      window.removeEventListener(TOGGLE_EVENT, onToggle);
      window.removeEventListener(SET_EVENT, onSet);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div
      className={`lg:hidden ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] transition-opacity ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface-container-lowest shadow-overlay transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-outline-variant px-4">
          {brand ? (
            <BrandMark brand={brand} />
          ) : (
            <span className="text-headline-sm font-bold text-on-surface">Workspace</span>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" aria-label="Primary mobile">
          {grouped
            ? groupsVisible.map((group) => (
                <div key={group.id} className="flex flex-col gap-1 pb-3">
                  <span className="px-3 pb-1 pt-2 text-label-sm uppercase tracking-wider text-outline">
                    {group.label}
                  </span>
                  {group.items.map((item) => (
                    <MobileNavLink key={item.id} item={item} pathname={pathname} badge={badges[item.id]} />
                  ))}
                </div>
              ))
            : flatVisible.map((item) => (
                <MobileNavLink key={item.id} item={item} pathname={pathname} badge={badges[item.id]} />
              ))}
        </nav>
      </aside>
    </div>
  );
}

export { setSidebar };
