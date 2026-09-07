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
  activeProduct: ProductKey;
  // This app's home (logo link + branch-switch landing) and navbar title.
  homeHref: string;
  title: string;
  // LMS-only notification bell (imports @lms/web) is injected as a slot so the
  // shared navbar carries no product knowledge. Omitted by hr/todo.
  notificationSlot?: React.ReactNode;
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
  homeHref,
  title,
  notificationSlot,
  adminWebUrl,
  lookupAdminUrl,
}: Props) {
  // Same question admin-web's own dashboard guard asks (a non-empty filtered
  // ADMIN_NAV): the pill must show for exactly the users that guard admits, or a
  // capability-granted, lower-ranked user reaches Admin only by typing the URL.
  const showAdminLink = !!adminWebUrl && canOpenAdminConsole(user);
  // Same contract one tier up: canOpenLookupAdmin() is the exact pair
  // lookup-admin's own layout guards on, so the pill shows for precisely the
  // accounts that console admits and never renders a link into its denial page.
  const showLookupAdminLink = !!lookupAdminUrl && canOpenLookupAdmin(user);
  const extraLinks = [
    ...(showAdminLink ? [{ key: 'admin', href: adminWebUrl!, label: 'Admin' }] : []),
    ...(showLookupAdminLink ? [{ key: 'sa', href: lookupAdminUrl!, label: 'SA' }] : []),
  ];
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-[#E2E8F0] bg-white">
      <div className="flex h-14 items-center gap-2 px-2 sm:gap-4 sm:px-5">
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
        <span className="hidden text-sm font-bold tracking-tight text-[#0F172A] sm:block">
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
        {/* Inline on sm+; on mobile the switcher drops to its own full-width row
            below so it doesn't get squeezed out by the rest of the bar. */}
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
      {/* Collapses to zero height when nothing renders (single product, no admin link). */}
      <div className="flex items-center gap-2 sm:hidden has-[nav]:border-t has-[nav]:border-[#E2E8F0] has-[nav]:px-2 has-[nav]:py-1.5">
        <ProductSwitcher
          licensedProducts={licensedProducts}
          actor={user}
          origins={productOrigins}
          activeProduct={activeProduct}
          extraLinks={extraLinks}
        />
      </div>
    </header>
  );
}
