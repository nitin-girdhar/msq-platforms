import Image from 'next/image';
import Link from 'next/link';
import type { SessionUser, ProductKey } from '@platform/types';
import { canOpenAdminConsole, canOpenLookupAdmin } from '@platform/rbac';
import { buildLoginUrl, buildChangePasswordUrl } from '../auth/sso';
import { withBasePath } from '../api/base-path';
import UserMenu from './UserMenu';
import BranchSwitcher from './BranchSwitcher';
import HamburgerButton from './HamburgerButton';
import ProductSwitcher from './ProductSwitcher';

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
  // LMS-only notification bell (imports @lms/web) is injected as a slot so the
  // shared navbar carries no product knowledge. Omitted by hr/todo.
  notificationSlot?: React.ReactNode;
  // Extra chrome controls for apps that scope the whole console from the bar —
  // lookup-admin's tenant + org selectors. Same slot contract as
  // notificationSlot: the shared navbar carries no knowledge of what's inside.
  // Rendered inline on sm+ and in the mobile second row below, so wide controls
  // never squeeze the top bar off-screen.
  scopeSlot?: React.ReactNode;
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
  adminWebUrl,
  lookupAdminUrl,
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
  // must be unconditional whenever one is passed.
  const mobileRowClass = scopeSlot
    ? 'flex flex-col gap-2 border-t border-[#E2E8F0] px-2 py-1.5 sm:hidden'
    : 'flex flex-col gap-2 sm:hidden has-[nav]:border-t has-[nav]:border-[#E2E8F0] has-[nav]:px-2 has-[nav]:py-1.5';
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-[#E2E8F0] bg-white">
      <div className="flex h-14 min-w-0 items-center gap-2 px-2 sm:gap-4 sm:px-5">
        <HamburgerButton />
        <Link href={homeHref} className="shrink-0" aria-label="Home">
          {/*
            withBasePath() is REQUIRED here — `next/image` does not add the
            prefix for us. The generated markup is
            `/lms/_next/image?url=%2Ffitclass-logo-white.webp`: the optimizer
            ENDPOINT is prefixed, but the `url` parameter is passed through
            verbatim and then resolved against the server root, where this app
            serves nothing. The optimizer answered 400 "The requested resource
            isn't a valid image" and the navbar rendered a broken-image icon in
            every product app. `url=%2Flms%2F…` returns 200.
          */}
          <Image
            src={withBasePath('/fitclass-logo-white.webp')}
            alt="FitClass"
            width={220}
            height={50}
            priority
            className="h-9 w-auto object-contain sm:h-10"
          />
        </Link>
        <div className="hidden h-5 w-px shrink-0 bg-[#E2E8F0] sm:block" />
        <span className="hidden truncate text-sm font-bold tracking-tight text-[#0F172A] sm:block">
          {title}
        </span>
        <div className="flex-1" />
        {/* Branch pill BEFORE the product tabs, not after: admin-web's header is
            hand-rolled but mounts BranchSwitcher in the same slot order (see
            apps/admin-web/app/dashboard/layout.tsx), so anchoring the tabs
            against the user menu keeps them in the same place on every app,
            whether or not the pill (which self-hides for single-branch and
            non-switching actors) shows. */}
        <BranchSwitcher user={user} homeHref={homeHref} />
        {/* Inline on sm+; on mobile both the scope controls and the switcher drop
            to their own full-width rows below so they don't get squeezed out by
            the rest of the bar. Rendering each twice (rather than reflowing one
            instance) is what lets the mobile copy be full-width while the
            desktop copy stays a compact inline group — only one is ever
            visible, the other is display:none. */}
        {scopeSlot && <div className="hidden items-center gap-2 sm:flex">{scopeSlot}</div>}
        <div className="hidden items-center gap-2 sm:flex">
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
      </div>
    </header>
  );
}
