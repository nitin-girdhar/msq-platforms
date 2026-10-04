import { getPublicBranding, resolveBrandKey } from '@platform/ui-kit/server';

/** The login link's (or remembered) brand for a pre-login page. Display only. */
export async function loadBrand(t: string | string[] | undefined) {
  const brandKey = await resolveBrandKey(t);
  const brand = await getPublicBranding(brandKey);
  return { brandKey, brand };
}
