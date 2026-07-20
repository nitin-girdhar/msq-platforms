import Image from 'next/image';
import Link from 'next/link';
import type { SessionUser, ProductKey } from '@crm/types';
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
}: Props) {
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-[#E2E8F0] bg-white">
      <div className="flex h-14 items-center gap-2 px-2 sm:gap-4 sm:px-5">
        <HamburgerButton />
        <Link href={homeHref} className="shrink-0" aria-label="Home">
          <Image
            src="/fitclass-logo-white.webp"
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
        <ProductSwitcher
          licensedProducts={licensedProducts}
          origins={productOrigins}
          activeProduct={activeProduct}
        />
        <BranchSwitcher user={user} homeHref={homeHref} />
        {notificationSlot}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
