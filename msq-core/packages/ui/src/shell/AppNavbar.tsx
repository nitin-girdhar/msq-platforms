import Link from 'next/link';
import type { SessionUser, ProductKey } from '@platform/types';
import { canOpenAdminConsole, canOpenLookupAdmin } from '@platform/rbac';
import { buildLoginUrl, buildChangePasswordUrl } from '../auth/sso';
import { withBasePath } from '../api/base-path';
import UserMenu from './UserMenu';
import BranchSwitcher from './BranchSwitcher';
import HamburgerButton from './HamburgerButton';
import ProductSwitcher from './ProductSwitcher';
import BrandMark from './BrandMark';
import NavbarTitle from './NavbarTitle';
import { DEFAULT_BRAND } from '../branding/defaults';

interface Props {
  user: SessionUser;
  licensedProducts: ProductKey[];
  // Absolute origin per product (from productOrigins()) + which product this
  // app is, for the cross-origin switcher.
  productOrigins: Record<ProductKey, string>;
  // Omitted by the Admin / Super Admin consoles: neither is a licensed product,
  // so no product chip is "current" there — they mark themselves via activeExtra
  // instead. ProductSwitcher already treats this as optional.
  activeProduct?: ProductKey;
  // Which non-product console this app IS, when it is one. Renders that pill
  // with the current-page treatment and points it at homeHref instead of the
  // cross-origin URL, so admin-web/lookup-admin don't hand-roll their own
  // extraLinks (and their own headers) just to say "you are here".
  activeExtra?: 'admin' | 'sa';
  // This app's home (logo link + branch-switch landing) and navbar title.
  homeHref: string;
  title: string;
  // Prefix the title with the tenant's brand name (product shells); admin consoles omit it.
  titleWithBrand?: boolean;
  // LMS-only notification bell (imports @lms/web) is injected as a slot so the
  // shared navbar carries no product knowledge. Omitted by hr/todo.
  notificationSlot?: React.ReactNode;
  // Extra chrome controls for apps that scope the whole console from the bar —
  // lookup-admin's tenant + org selectors. Same slot contract as
  // notificationSlot: the shared navbar carries no knowledge of what's inside.
  // Rendered inline on sm+ and in the mobile second row below, so wide controls
  // never squeeze the top bar off-screen. Passing one also hides BranchSwitcher:
  // the slot IS the console's scope, and the session branch is not.
  scopeSlot?: React.ReactNode;
  // A page filter that sits right beside the branch pill — lms-web's Leads
  // "Type" filter. Same slot contract again: the host decides what renders and
  // on which page (the component may return null), the navbar only places it.
  // Inline on xl+; below that it drops to the second row, like scopeSlot.
  filterSlot?: React.ReactNode;
  // Product search (LMS lead search). Same slot contract: the host owns what
  // renders; the bar places it left of the branch pill. The component handles
  // its own phone layout (icon → full-width row).
  searchSlot?: React.ReactNode;
  // admin-web's origin (adminWebOrigin()), for the standalone "Admin" link.
  // Deliberately NOT plumbed through ProductSwitcher/licensedProducts: admin-web
  // is capability-gated (canOpenAdminConsole), not a licensed product, so it must
  // never be chosen as a landing target or compete with LMS/HR/Task in that
  // switcher — see adminWebOrigin()'s doc comment in auth/sso.ts. Omitted/empty
  // hides the link entirely (e.g. single-host local dev with no ADMIN_WEB_URL set).
  adminWebUrl?: string;
  // lookup-admin's base URL (adminOrigin()), for the standalone "SA" link —
  // super_admin-only platform tooling. Same reasoning as adminWebUrl above: not
  // a licensed product, so it stays out of ProductSwitcher/licensedProducts and
  // rides in as an extra link. Omitted/empty hides it entirely.
  lookupAdminUrl?: string;
  // Set by AppShell: the full-height AppSidebar beside this bar already shows
  // the logo + product name on desktop, so the bar shows them only below lg
  // (where the rail is hidden and the drawer takes over).
  brandInSidebar?: boolean;
  // Brand name / product line for the mobile logo block. Defaults keep the
  // pre-AppShell look for callers that pass neither.
  brandName?: string;
}

// Shared top bar for every product app. Product-agnostic: identity, nav targets,
// and the product-specific notification UI all come in as props/slots.
export default function AppNavbar({
  user,
  licensedProducts,
  productOrigins,
  activeProduct,
  activeExtra,
  homeHref,
  title,
  notificationSlot,
  scopeSlot,
  filterSlot,
  searchSlot,
  adminWebUrl,
  lookupAdminUrl,
  brandInSidebar = false,
  brandName = DEFAULT_BRAND.name,
  titleWithBrand = false,
}: Props) {
  // Same question admin-web's own dashboard guard asks (a non-empty filtered
  // ADMIN_NAV): the pill must show for exactly the users that guard admits, or a
  // capability-granted, lower-ranked user reaches Admin only by typing the URL.
  // The activeExtra arm needs no capability question: that console's own layout
  // already ran the identical guard to render this page at all, and it is the
  // page you are standing on.
  const adminActive = activeExtra === 'admin';
  const saActive = activeExtra === 'sa';
  const showAdminLink = adminActive || (!!adminWebUrl && canOpenAdminConsole(user));
  // Same contract one tier up: canOpenLookupAdmin() is the exact pair
  // lookup-admin's own layout guards on, so the pill shows for precisely the
  // accounts that console admits and never renders a link into its denial page.
  const showLookupAdminLink = saActive || (!!lookupAdminUrl && canOpenLookupAdmin(user));
  const extraLinks = [
    ...(showAdminLink
      ? [{ key: 'admin', href: adminActive ? homeHref : adminWebUrl!, label: 'Admin', active: adminActive }]
      : []),
    ...(showLookupAdminLink
      ? [{ key: 'sa', href: saActive ? homeHref : lookupAdminUrl!, label: 'SA', active: saActive }]
      : []),
  ];
  // The mobile strip collapses to nothing when ProductSwitcher returns null
  // (single product, no extra links) — that's what has-[nav]: buys. A scopeSlot
  // has no such escape hatch: it always renders, so the row's border and padding
  // must be unconditional whenever one is passed. A filterSlot is the opposite
  // case — it renders nothing off its own page — so it joins the has-[] test via
  // its wrapper, which is :empty exactly when the filter chose not to render.
  const mobileRowClass = scopeSlot
    ? 'flex flex-col gap-2 border-t border-outline-variant px-2 py-1.5 xl:hidden'
    : 'flex flex-col gap-2 xl:hidden has-[nav,[data-slot=filter]:not(:empty)]:border-t has-[nav,[data-slot=filter]:not(:empty)]:border-outline-variant has-[nav,[data-slot=filter]:not(:empty)]:px-2 has-[nav,[data-slot=filter]:not(:empty)]:py-1.5';
  return (
    <header className="sticky top-0 z-30 shrink-0 bg-surface-container-lowest shadow-card">
      <div className="flex h-16 min-w-0 items-center gap-2 px-2 sm:gap-3 sm:px-5">
        <HamburgerButton />
        {/* Logo + title. With brandInSidebar the rail owns them on desktop. */}
        <div className={`flex min-w-0 shrink items-center gap-3 ${brandInSidebar ? 'lg:hidden' : ''}`}>
          <BrandMark brand={{ homeHref, name: brandName }} compact />
          <span className="hidden h-5 w-px shrink-0 bg-outline-variant sm:block" />
          <NavbarTitle title={title} withBrand={titleWithBrand} brandName={brandName} />
        </div>
        <div className="flex-1" />
        {searchSlot}
        {/* Branch pill BEFORE the product tabs, not after: admin-web's header is
            rendered through this same navbar (see
            apps/admin-web/app/dashboard/layout.tsx), so anchoring the tabs
            against the user menu keeps them in the same place on every app,
            whether or not the pill (which self-hides for single-branch and
            non-switching actors) shows.
            Suppressed when the host passes a scopeSlot: that console scopes
            itself from its own selectors (lookup-admin's tenant + org), so the
            actor's session branch would be a second, contradictory scope
            control that none of its pages read. */}
        {!scopeSlot && <BranchSwitcher user={user} homeHref={homeHref} />}
        {filterSlot && <div className="hidden items-center xl:flex">{filterSlot}</div>}
        {/* Inline on xl+ (1280px); below that both the scope controls and the switcher drop
            to their own full-width rows below so they don't get squeezed out by
            the rest of the bar. Rendering each twice (rather than reflowing one
            instance) is what lets the mobile copy be full-width while the
            desktop copy stays a compact inline group — only one is ever
            visible, the other is display:none. */}
        {scopeSlot && <div className="hidden items-center gap-2 xl:flex">{scopeSlot}</div>}
        <div className="hidden items-center gap-2 xl:flex">
          <ProductSwitcher
            licensedProducts={licensedProducts}
            actor={user}
            origins={productOrigins}
            activeProduct={activeProduct}
            extraLinks={extraLinks}
          />
        </div>
        {notificationSlot}
        <UserMenu user={user} loginUrl={buildLoginUrl()} changePasswordUrl={buildChangePasswordUrl()} />
      </div>
      {/* Collapses to zero height when nothing renders (single product, no admin
          link, no scope slot) — see mobileRowClass. */}
      <div className={mobileRowClass}>
        <ProductSwitcher
          licensedProducts={licensedProducts}
          actor={user}
          origins={productOrigins}
          activeProduct={activeProduct}
          extraLinks={extraLinks}
        />
        {scopeSlot && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{scopeSlot}</div>
        )}
        {filterSlot && <div data-slot="filter" className="flex min-w-0 items-center">{filterSlot}</div>}
      </div>
    </header>
  );
}
