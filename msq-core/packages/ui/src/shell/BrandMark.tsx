'use client';

import Image from 'next/image';
import Link from 'next/link';
import { withBasePath } from '../api/base-path';
import { useBranding } from '../branding/BrandingProvider';
import type { BrandProductKey } from '../branding/types';

/**
 * What the chrome shows as "who this is": logo + brand name + product line.
 * The app passes its defaults; the session tenant's branding (Super Admin →
 * logo mark, brand name, product names) overrides them from BrandingProvider,
 * so no product layout changes when a tenant uploads its own mark.
 */
export interface ShellBrand {
  // This app's home — the logo links here.
  homeHref: string;
  // Brand name, e.g. "Fitclass".
  name: string;
  // Product line under the name, e.g. "Lead Management". Optional.
  product?: string;
  // Which product this is — selects the tenant's product name for the line.
  productKey?: BrandProductKey;
  // Square logo mark. Omitted → the tenant's mark, else the bundled emblem.
  markSrc?: string;
}

const DEFAULT_MARK = '/fitclass-emblem.png';

interface Props {
  brand: ShellBrand;
  // Mark only (collapsed rail / tight mobile bar).
  compact?: boolean;
}

export default function BrandMark({ brand, compact = false }: Props) {
  const branding = useBranding();
  const name = branding.brandName ?? brand.name;
  const product = (brand.productKey && branding.productNames[brand.productKey]?.title) || brand.product;
  // A tenant mark is served by the gateway under /api (immutable, ?v= busted);
  // rendered unoptimized because the Next image optimizer of THIS app cannot
  // fetch another app's rewrite. withBasePath() is REQUIRED for the bundled
  // emblem — next/image prefixes the optimizer endpoint but passes `url`
  // through verbatim, so an unprefixed path 400s under /lms, /hrms, ….
  const tenantMark = brand.markSrc ?? branding.assets.mark;
  const src = tenantMark ?? withBasePath(DEFAULT_MARK);
  return (
    <Link
      href={brand.homeHref}
      aria-label={`${name} home`}
      className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Image
        src={src}
        alt=""
        width={160}
        height={160}
        priority
        unoptimized={Boolean(tenantMark)}
        className="h-9 w-9 shrink-0 rounded-lg object-contain"
      />
      {!compact && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-headline-sm font-bold text-on-surface">{name}</span>
          {product && (
            <span className="truncate text-label-sm uppercase tracking-wider text-outline">{product}</span>
          )}
        </span>
      )}
    </Link>
  );
}
