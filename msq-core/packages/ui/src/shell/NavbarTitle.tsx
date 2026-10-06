'use client';

import { useBranding } from '../branding/BrandingProvider';

/**
 * Navbar title. A product passes only its own title ("People & Attendance");
 * with `withBrand` the tenant's brand name is put in front ("Acme - People &
 * Attendance"), falling back to the app's `brandName` (DEFAULT_BRAND.name) for a
 * tenant that has not set one. Admin consoles pass plain titles and no flag.
 */
export default function NavbarTitle({ title, withBrand = false, brandName }: { title: string; withBrand?: boolean; brandName: string }) {
  const branding = useBranding();
  const text = withBrand ? `${branding.brandName ?? brandName} - ${title}` : title;
  return <span className="hidden truncate text-headline-sm font-bold text-on-surface sm:block">{text}</span>;
}
