'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Count per nav item id (e.g. LMS overdue follow-ups). The product app computes
// it and mounts a provider around AppShell, so the desktop rail, the mobile
// drawer and the mobile tab bar all show the same number without each being
// handed props through a server component. Purely informational: a badge never
// affects visibility or access.
export type NavBadgeMap = Readonly<Record<string, number>>;

const EMPTY: NavBadgeMap = {};
const NavBadgesContext = createContext<NavBadgeMap>(EMPTY);

export function NavBadgesProvider({ value, children }: { value: NavBadgeMap; children: ReactNode }) {
  return <NavBadgesContext.Provider value={value}>{children}</NavBadgesContext.Provider>;
}

export function useNavBadges(): NavBadgeMap {
  return useContext(NavBadgesContext);
}

export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}
