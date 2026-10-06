import { isNavIconName, type NavIconName } from '../shell/NavIcon';
import { DEFAULT_THEME, resolveTheme, type EffectiveTheme, type ThemeChoice } from '../theme/presets';
import { DEFAULT_LOCALE_CONFIG, localeFromApi, type LocaleConfig } from '../locale/config';

// Tenant identity branding as the UI consumes it (GET /me/branding, schema
// 1.57.0). Labels and images only — routes, nav ids, capabilities and API
// field names never change with branding.

export type BrandProductKey = 'lms' | 'hr' | 'task' | 'admin' | 'sa';
export type BrandAssetSlot =
  | 'logo' | 'logo_dark' | 'mark' | 'favicon' | 'app_icon'
  | 'app_icon_maskable' | 'apple_touch_icon' | 'icon_192' | 'push_icon' | 'push_badge'
  | 'email_logo' | 'login_hero' | 'splash';
export type BrandTermKey =
  | 'lead' | 'leads' | 'counselor' | 'counselors' | 'follow_up' | 'follow_ups'
  | 'branch' | 'branches' | 'assignment' | 'assignments' | 'walk_in' | 'walk_ins';

export interface ProductNames {
  title?: string;
  tab_title?: string;
  short?: string;
  switcher?: string;
}

export interface NavOverride {
  label?: string;
  icon?: string;
}

export interface Branding {
  theme: EffectiveTheme;
  /** The company's own theme (tenant layer only, no personal override) — what the Appearance panel inherits and Resets to. */
  companyTheme: EffectiveTheme;
  /** Super Admin locked colours/font: users keep only their light/dark choice. */
  locked: boolean;
  /** The user's own stored appearance override (null = company theme). */
  personal: ThemeChoice | null;
  brandName: string | null;
  productNames: Partial<Record<BrandProductKey, ProductNames>>;
  terms: Partial<Record<BrandTermKey, string>>;
  navOverrides: Record<string, NavOverride>;
  /** Tenant regional formats (date, time, number, currency, week, fiscal year). */
  locale: LocaleConfig;
  /** Browser-reachable URLs (single origin: the gateway lives under /api). */
  assets: Partial<Record<BrandAssetSlot, string>>;
  publicKey: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  theme: DEFAULT_THEME,
  companyTheme: DEFAULT_THEME,
  locked: false,
  personal: null,
  brandName: null,
  productNames: {},
  terms: {},
  navOverrides: {},
  locale: DEFAULT_LOCALE_CONFIG,
  assets: {},
  publicKey: null,
};

// Gateway-relative asset path → URL the browser can load. Every app shares one
// origin and auth-web rewrites /api/* to the gateway, so /api/<path> works from
// any basePath (a plain <img src> is never basePath-prefixed).
export const BROWSER_GATEWAY_PREFIX = '/api';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

function stringRecord(v: unknown): Record<string, string> {
  if (!isObj(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    const s = str(val);
    if (s) out[k] = s;
  }
  return out;
}

function assetUrls(v: unknown): Branding['assets'] {
  const out: Branding['assets'] = {};
  for (const [slot, path] of Object.entries(stringRecord(v))) {
    // Only gateway-relative paths the identity-service minted — never an
    // arbitrary absolute URL from a stale/odd row.
    if (path.startsWith('/public/branding/')) out[slot as BrandAssetSlot] = `${BROWSER_GATEWAY_PREFIX}${path}`;
  }
  return out;
}

/**
 * GET /me/branding `data` → Branding. Defensive: the API validates on write,
 * this guards the read side so a malformed row degrades to the default.
 */
export function brandingFromApi(data: unknown): Branding {
  if (!isObj(data)) return DEFAULT_BRANDING;
  const theme = isObj(data['theme']) ? data['theme'] : {};
  const names = isObj(data['product_names']) ? data['product_names'] : {};
  const productNames: Branding['productNames'] = {};
  for (const key of ['lms', 'hr', 'task', 'admin', 'sa'] as const) {
    const n = stringRecord(names[key]);
    if (Object.keys(n).length) productNames[key] = n as ProductNames;
  }
  const navOverrides: Record<string, NavOverride> = {};
  if (isObj(data['nav_overrides'])) {
    for (const [id, o] of Object.entries(data['nav_overrides'])) {
      const r = stringRecord(o);
      const entry: NavOverride = {};
      if (r['label']) entry.label = r['label'];
      if (r['icon']) entry.icon = r['icon'];
      if (entry.label || entry.icon) navOverrides[id] = entry;
    }
  }
  const brand = isObj(names['brand']) ? str(names['brand']['name']) : undefined;
  return {
    theme: resolveTheme(theme['tenant'] as ThemeChoice | null, theme['user'] as ThemeChoice | null),
    companyTheme: resolveTheme(theme['tenant'] as ThemeChoice | null),
    locked: theme['locked'] === true,
    personal: isObj(data['personal']) ? (data['personal'] as ThemeChoice) : null,
    brandName: brand ?? null,
    productNames,
    terms: stringRecord(data['terms']) as Branding['terms'],
    navOverrides,
    locale: localeFromApi(data['locale']),
    assets: assetUrls(data['assets']),
    publicKey: str(data['public_key']) ?? null,
  };
}

/** A tenant's label for a nav item, falling back to the app's own. */
export function applyNavOverride<T extends { id: string; label: string; icon?: NavIconName | undefined }>(
  item: T,
  overrides: Record<string, NavOverride>,
): T {
  const o = overrides[item.id];
  if (!o) return item;
  const icon = o.icon && isNavIconName(o.icon) ? o.icon : item.icon;
  return { ...item, label: o.label ?? item.label, ...(icon ? { icon } : {}) };
}

// ── Pre-login (login link ?t=<public_key>) ───────────────────────────────────

export interface PublicBranding {
  theme: EffectiveTheme;
  brandName: string | null;
  /** Product-switcher labels for the login hero's chips. */
  productLabels: string[];
  assets: Partial<Record<BrandAssetSlot, string>>;
}

export const DEFAULT_PUBLIC_BRANDING: PublicBranding = {
  theme: DEFAULT_THEME,
  brandName: null,
  productLabels: [],
  assets: {},
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isBrandKey(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** GET /public/branding/:key `data` → PublicBranding (unknown key → default shape). */
export function publicBrandingFromApi(data: unknown): PublicBranding {
  if (!isObj(data)) return DEFAULT_PUBLIC_BRANDING;
  const labels = Array.isArray(data['product_labels'])
    ? data['product_labels'].filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 6)
    : [];
  return {
    theme: resolveTheme(data['theme'] as ThemeChoice | null),
    brandName: str(data['brand_name']) ?? null,
    productLabels: labels,
    assets: assetUrls(data['assets']),
  };
}

/** Cookie remembering the last login link's brand on this device (display only). */
export const BRAND_KEY_COOKIE = 'msq_brand';
