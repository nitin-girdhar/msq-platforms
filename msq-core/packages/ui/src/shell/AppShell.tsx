import type { ComponentProps, ReactNode } from 'react';
import type { SessionUser } from '@platform/types';
import AppNavbar from './AppNavbar';
import AppSidebar from './AppSidebar';
import MobileSidebar from './MobileSidebar';
import MobileTabBar from './MobileTabBar';
import type { NavItem, NavGroup } from './nav';
import type { BrandProductKey } from '../branding/types';
import { DEFAULT_BRAND } from '../branding/defaults';

type NavbarProps = ComponentProps<typeof AppNavbar>;

interface Props extends Omit<NavbarProps, 'brandInSidebar' | 'brandName'> {
  // The product's nav (flat or grouped) — filtered per actor inside.
  nav: readonly NavItem[] | readonly NavGroup[];
  // Brand block at the top of the rail / drawer. Defaults to the platform brand (DEFAULT_BRAND); tenant
  // branding (logos & product names, Super Admin) will feed these.
  brandName?: string;
  // Short product line under the brand name in the rail, e.g. "Lead Management".
  productLine?: string;
  // Selects the tenant's product name (Super Admin branding) over productLine.
  productKey?: BrandProductKey;
  // Optional client component rendered as the per-item nav badge source — see
  // AppSidebar `badges`. Kept out of this server component on purpose.
  sidebar?: (props: { actor: SessionUser }) => ReactNode;
  // Opt-in phone bottom tab bar (Stitch mobile screens): one entry per tab, each
  // a list of nav item ids in preference order — see MobileTabBar. Omitted =
  // no bar, so other products are unchanged.
  mobileTabs?: readonly (readonly string[])[];
  // Optional block at the foot of the desktop rail, above Collapse (see AppSidebar footerSlot).
  sidebarFooter?: ReactNode;
  children: ReactNode;
}

/**
 * The platform app frame (Stitch "Precision Enterprise Kinetic" layout):
 * a full-height left rail that owns the brand, and the top bar + content to its
 * right. Below lg the rail is hidden and the navbar's hamburger opens the
 * MobileSidebar drawer.
 *
 * Every product layout renders this instead of hand-composing
 * AppNavbar/AppSidebar/MobileSidebar, so the frame changes in ONE place. The
 * parts stay exported for anything that needs them individually.
 *
 * Height policy is unchanged from the hand-composed frames: at ≥1024px the
 * body is pinned to 100dvh (globals.css) and only <main> scrolls; below that
 * the page scrolls normally.
 */
export default function AppShell({ nav, brandName = DEFAULT_BRAND.name, productLine, productKey, sidebar, mobileTabs, sidebarFooter, children, ...navbar }: Props) {
  const brand = {
    homeHref: navbar.homeHref,
    name: brandName,
    ...(productLine ? { product: productLine } : {}),
    ...(productKey ? { productKey } : {}),
  };
  return (
    <div className="flex min-h-screen w-full bg-background lg:h-full lg:min-h-0 lg:overflow-hidden">
      {sidebar ? sidebar({ actor: navbar.user }) : <AppSidebar actor={navbar.user} items={nav} brand={brand} footerSlot={sidebarFooter} />}
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
        <AppNavbar {...navbar} brandInSidebar brandName={brandName} />
        <MobileSidebar actor={navbar.user} items={nav} brand={brand} />
        {/* pb clears the fixed tab bar (h-14 + safe area) below lg */}
        <main className={`flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto ${mobileTabs?.length ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0' : ''}`}>{children}</main>
        {mobileTabs?.length ? <MobileTabBar actor={navbar.user} items={nav} tabs={mobileTabs} /> : null}
      </div>
    </div>
  );
}
