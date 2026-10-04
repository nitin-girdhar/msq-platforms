// @platform/ui-kit/branding — tenant identity branding (names, terms, menu
// overrides, logos). The provider is a client module; types/parsing are pure.
export {
  DEFAULT_BRANDING,
  BROWSER_GATEWAY_PREFIX,
  brandingFromApi,
  applyNavOverride,
  DEFAULT_PUBLIC_BRANDING,
  publicBrandingFromApi,
  isBrandKey,
  BRAND_KEY_COOKIE,
} from './types';
export type {
  Branding,
  BrandProductKey,
  BrandAssetSlot,
  BrandTermKey,
  ProductNames,
  NavOverride,
  PublicBranding,
} from './types';
export { BrandingProvider, useBranding, useTerm, useProductName, Term } from './BrandingProvider';
export { BRANDABLE_NAV, BRAND_TERM_ROWS } from './catalog';
export type { BrandableNavItem } from './catalog';
export { NAV_ICON_NAMES, isNavIconName } from '../shell/NavIcon';
export { default as NavIcon } from '../shell/NavIcon';
