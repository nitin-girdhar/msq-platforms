'use client';

import { useBranding } from '../branding/BrandingProvider';
import type { BrandProductKey } from '../branding/types';

const BRANDABLE = new Set<string>(['lms', 'hr', 'task', 'admin', 'sa']);

/**
 * A product's switcher label: the tenant's name for it (Super Admin branding,
 * `product_names.<key>.switcher`), else the platform default. Client-side so
 * the server-rendered switcher needs no branding plumbing.
 */
export default function ProductLabel({ product, fallback }: { product: string; fallback: string }) {
  const { productNames } = useBranding();
  const name = BRANDABLE.has(product) ? productNames[product as BrandProductKey]?.switcher : undefined;
  return <>{name ?? fallback}</>;
}
