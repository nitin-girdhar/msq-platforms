import { cache } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import {
  BRAND_KEY_COOKIE,
  DEFAULT_PUBLIC_BRANDING,
  isBrandKey,
  publicBrandingFromApi,
  type BrandProductKey,
  type PublicBranding,
} from '../branding/types';
import { DEFAULT_BRAND } from '../branding/defaults';
import { getEffectiveBranding } from './theme';

const GATEWAY_URL = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';

/**
 * Display branding for a login link key (no session exists yet). The key is
 * the tenant's rotatable public_key — never the tenant id — and the answer is
 * display data only; sign-in never trusts it (the tenant still comes from the
 * authenticated user). Cached 5 minutes per key, so the gateway's per-IP
 * branding limit is not spent by this server on every page view. Fails open
 * to the platform default.
 */
export const getPublicBranding = cache(async (key: string | null | undefined): Promise<PublicBranding> => {
  if (!isBrandKey(key)) return DEFAULT_PUBLIC_BRANDING;
  try {
    const res = await fetch(`${GATEWAY_URL}/public/branding/${key}`, { next: { revalidate: 300 } });
    if (!res.ok) return DEFAULT_PUBLIC_BRANDING;
    const body = (await res.json()) as { data?: unknown };
    return publicBrandingFromApi(body.data);
  } catch {
    return DEFAULT_PUBLIC_BRANDING;
  }
});

/**
 * The brand key a pre-login page should render: the link's `?t=` first, else
 * the one this device remembered from its last login link.
 */
export async function resolveBrandKey(fromQuery: string | string[] | undefined): Promise<string | null> {
  const q = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (isBrandKey(q)) return q;
  const remembered = (await cookies()).get(BRAND_KEY_COOKIE)?.value;
  return isBrandKey(remembered) ? remembered : null;
}

/**
 * A product root layout's metadata with the session tenant's branding laid
 * over it: tab title (product tab_title → title), favicon, Apple touch icon,
 * Home Screen title and a manifest keyed by the tenant's public key (a
 * manifest fetch carries no session cookie, so the key travels in the URL).
 * A default tenant gets `base` back unchanged.
 */
export async function brandedMetadata(base: Metadata, product: BrandProductKey): Promise<Metadata> {
  const b = await getEffectiveBranding();
  const names = b.productNames[product];
  const title = names?.tab_title ?? names?.title;
  const out: Metadata = { ...base };
  if (title) out.title = title;
  const apple = b.assets.apple_touch_icon ?? b.assets.app_icon;
  if (b.assets.favicon || apple) {
    out.icons = {
      icon: b.assets.favicon ?? DEFAULT_BRAND.icons.favicon,
      apple: apple ?? DEFAULT_BRAND.icons.appleTouch,
    };
  }
  if (b.publicKey && base.manifest) out.manifest = `/manifest.webmanifest?b=${b.publicKey}`;
  const short = names?.short ?? b.brandName;
  if (short && base.appleWebApp && typeof base.appleWebApp === 'object') {
    out.appleWebApp = { ...base.appleWebApp, title: short };
  }
  return out;
}
