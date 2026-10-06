'use client';

import Image from 'next/image';
import Link from 'next/link';
import { withBasePath } from '../api/base-path';
import { useBranding } from '../branding/BrandingProvider';
import { DEFAULT_BRAND } from '../branding/defaults';
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
  // Brand name shown when the tenant has not set one (apps pass DEFAULT_BRAND.name).
  name: string;
  // Product line under the name, e.g. "Lead Management". Optional.
  product?: string;
  // Which product this is — selects the tenant's product name for the line.
  productKey?: BrandProductKey;
  // Square logo mark. Omitted → the tenant's mark, else the bundled emblem.
  markSrc?: string;
}

const DEFAULT_MARK = DEFAULT_BRAND.emblem;

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
  // The tenant's full logo replaces mark + name in the expanded rail. The dark
  // variant (if uploaded) is swapped in by CSS under html[data-mode="dark"], so
  // there is no flash and no theme branching here; without one the light logo is
  // used in both modes. Collapsed/compact always shows the square mark.
  const logo = branding.assets.logo;
  const logoDark = branding.assets.logo_dark;
  const showLogo = !compact && Boolean(logo);
  return (
    <Link
      href={brand.homeHref}
      aria-label={`${name} home`}
      className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {showLogo ? (
        <span className="flex min-w-0 flex-col gap-1 leading-tight">
          {/* Tenant logos are gateway-served (/api/public/branding/...); a plain
              <img> keeps the natural aspect ratio and skips the optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo}
            alt={name}
            className={`h-9 w-auto max-w-[11rem] object-contain object-left ${logoDark ? "[html[data-mode='dark']_&]:hidden" : ''}`}
          />
          {logoDark && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoDark}
              alt={name}
              className="hidden h-9 w-auto max-w-[11rem] object-contain object-left [html[data-mode='dark']_&]:block"
            />
          )}
          {product && (
            <span className="truncate text-label-sm uppercase tracking-wider text-outline">{product}</span>
          )}
        </span>
      ) : (
        <>
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
        </>
      )}
    </Link>
  );
}
