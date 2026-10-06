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
export { DEFAULT_BRAND, platformName } from './defaults';
export { BrandingProvider, useBranding, useTerm, useProductName, Term } from './BrandingProvider';
export { BRANDABLE_NAV, BRAND_TERM_ROWS } from './catalog';
export {
  BRAND_ASSET_CATALOG,
  BRAND_ASSET_GROUPS,
  BRAND_ASSET_NEED_LABEL,
  BRAND_ASSET_DARK_PREVIEW,
} from './assets';
export type { BrandAssetSpec, BrandAssetNeed, BrandAssetGroupId } from './assets';
export type { BrandableNavItem } from './catalog';
export { NAV_ICON_NAMES, isNavIconName } from '../shell/NavIcon';
export { default as NavIcon } from '../shell/NavIcon';
