// Branding & appearance request schemas (schema 1.57.0).
//
// The id lists below are the SERVER-SIDE gate for what may be stored. They
// mirror three places that must stay in step:
//   - db_scripts/03_tables_product.sql  CHECK constraints on entity.tenant_branding
//   - @platform/ui-kit/theme presets.ts THEME_PRESETS / BRAND_FONTS / THEME_MODES
//   - next/font declarations in @platform/ui-kit/theme fonts.ts
// (ui-kit's theme test asserts its lists equal these.)
import { z } from 'zod';
import { COLOR_ROLE_IDS } from './color-roles.js';

export const BRAND_PRESET_IDS = [
  'indigo-kinetic', 'pacific-ocean', 'teal-horizon', 'sky-velocity',
  'emerald-fit', 'royal-violet', 'electric-amber', 'slate-modern',
] as const;
export const BRAND_FONT_IDS = [
  'inter', 'manrope', 'dm-sans', 'ibm-plex-sans', 'plus-jakarta-sans', 'public-sans', 'outfit',
] as const;
export const THEME_MODE_IDS = ['light', 'dark', 'system'] as const;
export const FONT_SIZE_IDS = ['sm', 'md', 'lg', 'xl'] as const;

/** Words a tenant may rename (singular + plural keys). Labels only — never routes, ids or permissions. */
export const BRAND_TERM_KEYS = [
  'lead', 'leads', 'counselor', 'counselors', 'follow_up', 'follow_ups',
  'branch', 'branches', 'assignment', 'assignments', 'walk_in', 'walk_ins',
] as const;

/** Products whose display names Super Admin may set. */
export const BRAND_PRODUCT_KEYS = ['lms', 'hr', 'task', 'admin', 'sa'] as const;

/** Uploadable brand asset slots (Super Admin only). */
export const BRAND_ASSET_SLOTS = [
  'logo', 'logo_dark', 'mark', 'favicon', 'app_icon',
  'app_icon_maskable', 'apple_touch_icon', 'icon_192', 'push_icon', 'push_badge',
  'email_logo', 'login_hero', 'splash',
] as const;
export type BrandAssetSlot = (typeof BRAND_ASSET_SLOTS)[number];

// Plain display text: no markup characters, trimmed, length-bounded. Rendered as
// text by React, but kept clean so an export / email / PDF never inherits HTML.
const displayText = (max: number) =>
  z.string().trim().min(1).max(max).regex(/^[^<>{}]*$/, 'Must not contain < > { }');

const seedHex = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, 'Use a #rrggbb colour');

/**
 * Hand-fine-tuned colour roles (schema 1.75.0): `{ light: { primary: '#0d4668' }, dark: {...} }`.
 * SPARSE — only roles that were changed; every other role keeps following the seed. Role names
 * are the whitelist in color-roles.ts (error / status colours are not editable, so naming one is
 * a 422), values are #rrggbb. The 3:1 readability floor is checked by the service against the
 * derived shades (findUnreadablePairs in theme-colors.ts) because it needs the seed.
 * An empty object clears every override.
 */
const roleHex = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, 'Use a #rrggbb colour');
const roleMap = z.record(z.enum(COLOR_ROLE_IDS), roleHex);
export const colorOverridesSchema = z.object({
  light: roleMap.optional(),
  dark: roleMap.optional(),
}).strict();
export type ColorOverridesInput = z.infer<typeof colorOverridesSchema>;

/**
 * A user's own theme override. All optional (absent = unchanged / inherit).
 * `font_size` is personal-only — the tenant schemas below deliberately omit it.
 */
export const themeChoiceSchema = z.object({
  preset: z.enum(BRAND_PRESET_IDS).nullable().optional(),
  seed_hex: seedHex.nullable().optional(),
  font: z.enum(BRAND_FONT_IDS).nullable().optional(),
  mode: z.enum(THEME_MODE_IDS).nullable().optional(),
  font_size: z.enum(FONT_SIZE_IDS).nullable().optional(),
  color_overrides: colorOverridesSchema.nullable().optional(),
}).strict();
export type ThemeChoiceInput = z.infer<typeof themeChoiceSchema>;

export const brandTermsSchema = z.record(z.enum(BRAND_TERM_KEYS), displayText(24)).default({});

// Nav item ids come from each app's nav config (e.g. 'leads', 'bulk-assign').
// The icon is a NavIconName; unknown names are ignored by the renderer, so the
// server only bounds the shape rather than pinning a list that lives in UI code.
export const navOverridesSchema = z
  .record(
    z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
    z.object({
      label: displayText(30).optional(),
      icon: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),
    }).strict(),
  )
  .refine((v) => Object.keys(v).length <= 60, 'Too many menu overrides')
  .default({});

// Per-product display names: navbar title, browser-tab title, home-screen short
// name (≤12, the PWA short_name limit), product-switcher label.
const productNameSchema = z.object({
  title: displayText(60).optional(),
  tab_title: displayText(60).optional(),
  short: displayText(12).optional(),
  switcher: displayText(20).optional(),
}).strict();

export const productNamesSchema = z.object({
  brand: z.object({ name: displayText(40).optional() }).strict().optional(),
  lms: productNameSchema.optional(),
  hr: productNameSchema.optional(),
  task: productNameSchema.optional(),
  admin: productNameSchema.optional(),
  sa: productNameSchema.optional(),
}).strict();
export type ProductNamesInput = z.infer<typeof productNamesSchema>;

// ── Regional formats (locale_config, schema 1.73.0; Super Admin sets them) ───
// Whitelists, never free text: every value is a key the shared formatter in
// @platform/ui-kit/locale understands (keep both lists in step — ui-kit's locale
// test asserts they match). Display only; stored data is UTC / ISO / NUMERIC.
export const LOCALE_IDS = ['en-IN', 'en-GB', 'en-US', 'en-AE', 'en-SG', 'en-AU', 'hi-IN'] as const;
export const DATE_FORMAT_IDS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY'] as const;
export const TIME_FORMAT_IDS = ['12h', '24h'] as const;
export const WEEK_START_IDS = ['monday', 'sunday', 'saturday'] as const;
export const CURRENCY_IDS = ['INR', 'USD', 'AED', 'SGD', 'GBP', 'EUR', 'AUD'] as const;
export const CURRENCY_DISPLAY_IDS = ['symbol', 'code'] as const;
export const NUMBER_GROUPING_IDS = ['indian', 'international'] as const;
export const PHONE_COUNTRY_CODES = ['+91', '+971', '+65', '+44', '+1', '+61'] as const;

const ianaTimezone = z.string().trim().max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');

export const localeConfigSchema = z.object({
  locale: z.enum(LOCALE_IDS).optional(),
  date_format: z.enum(DATE_FORMAT_IDS).optional(),
  time_format: z.enum(TIME_FORMAT_IDS).optional(),
  timezone: ianaTimezone.optional(),
  week_start: z.enum(WEEK_START_IDS).optional(),
  currency: z.enum(CURRENCY_IDS).optional(),
  currency_display: z.enum(CURRENCY_DISPLAY_IDS).optional(),
  number_grouping: z.enum(NUMBER_GROUPING_IDS).optional(),
  fiscal_year_start: z.number().int().min(1).max(12).optional(),
  phone_country_code: z.enum(PHONE_COUNTRY_CODES).optional(),
}).strict();
export type LocaleConfigInput = z.infer<typeof localeConfigSchema>;

/**
 * PUT /tenant/branding — the tenant admin's whole remit: colour (seed and hand-tuned roles), font and the default
 * light/dark mode (and only while the theme is unlocked). Everything else — images,
 * names, renamed words, menu labels, regional formats — is Super Admin's (schema below),
 * so a forged body carrying any of them is a 422 (`.strict()`), not a silent write.
 */
export const tenantBrandingUpdateSchema = z.object({
  preset: z.enum(BRAND_PRESET_IDS).nullable().optional(),
  seed_hex: seedHex.nullable().optional(),
  font: z.enum(BRAND_FONT_IDS).nullable().optional(),
  default_mode: z.enum(THEME_MODE_IDS).optional(),
  color_overrides: colorOverridesSchema.optional(),
}).strict();
export type TenantBrandingUpdateInput = z.infer<typeof tenantBrandingUpdateSchema>;

/** PUT /sa/tenants/:id/branding — Super Admin: theme + lock + names + words + menu labels + regional formats. */
export const saBrandingUpdateSchema = z.object({
  preset: z.enum(BRAND_PRESET_IDS).nullable().optional(),
  seed_hex: seedHex.nullable().optional(),
  font: z.enum(BRAND_FONT_IDS).nullable().optional(),
  default_mode: z.enum(THEME_MODE_IDS).optional(),
  color_overrides: colorOverridesSchema.optional(),
  theme_locked: z.boolean().optional(),
  product_names: productNamesSchema.optional(),
  terms: brandTermsSchema.optional(),
  nav_overrides: navOverridesSchema.optional(),
  locale_config: localeConfigSchema.optional(),
}).strict();
export type SaBrandingUpdateInput = z.infer<typeof saBrandingUpdateSchema>;

/** POST /sa/tenants/:id/branding/assets/:slot — base64 (optionally a data: URI). */
export const brandAssetUploadSchema = z.object({
  data: z.string().min(16).max(2_800_000),
}).strict();
export type BrandAssetUploadInput = z.infer<typeof brandAssetUploadSchema>;

/** PUT /me/preferences/theme — the user's own override. */
export const userThemeUpdateSchema = themeChoiceSchema;
export type UserThemeUpdateInput = ThemeChoiceInput;
