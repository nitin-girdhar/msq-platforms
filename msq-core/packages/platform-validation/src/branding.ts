// Branding & appearance request schemas (schema 1.57.0).
//
// The id lists below are the SERVER-SIDE gate for what may be stored. They
// mirror three places that must stay in step:
//   - db_scripts/03_tables_product.sql  CHECK constraints on entity.tenant_branding
//   - @platform/ui-kit/theme presets.ts THEME_PRESETS / BRAND_FONTS / THEME_MODES
//   - next/font declarations in @platform/ui-kit/theme fonts.ts
// (ui-kit's theme test asserts its lists equal these.)
import { z } from 'zod';

export const BRAND_PRESET_IDS = [
  'indigo-kinetic', 'pacific-ocean', 'teal-horizon', 'sky-velocity',
  'emerald-fit', 'royal-violet', 'electric-amber', 'slate-modern',
] as const;
export const BRAND_FONT_IDS = [
  'inter', 'manrope', 'dm-sans', 'ibm-plex-sans', 'plus-jakarta-sans', 'public-sans', 'outfit',
] as const;
export const THEME_MODE_IDS = ['light', 'dark', 'system'] as const;

/** Words a tenant may rename (singular + plural keys). Labels only — never routes, ids or permissions. */
export const BRAND_TERM_KEYS = [
  'lead', 'leads', 'counselor', 'counselors', 'follow_up', 'follow_ups',
  'branch', 'branches', 'assignment', 'assignments', 'walk_in', 'walk_ins',
] as const;

/** Products whose display names Super Admin may set. */
export const BRAND_PRODUCT_KEYS = ['lms', 'hr', 'task', 'admin', 'sa'] as const;

/** Uploadable brand asset slots (Super Admin). */
export const BRAND_ASSET_SLOTS = ['logo', 'logo_dark', 'mark', 'favicon', 'app_icon'] as const;
export type BrandAssetSlot = (typeof BRAND_ASSET_SLOTS)[number];

// Plain display text: no markup characters, trimmed, length-bounded. Rendered as
// text by React, but kept clean so an export / email / PDF never inherits HTML.
const displayText = (max: number) =>
  z.string().trim().min(1).max(max).regex(/^[^<>{}]*$/, 'Must not contain < > { }');

const seedHex = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, 'Use a #rrggbb colour');

/** Theme fields shared by tenant branding and a user's override. All optional (absent = unchanged / inherit). */
export const themeChoiceSchema = z.object({
  preset: z.enum(BRAND_PRESET_IDS).nullable().optional(),
  seed_hex: seedHex.nullable().optional(),
  font: z.enum(BRAND_FONT_IDS).nullable().optional(),
  mode: z.enum(THEME_MODE_IDS).nullable().optional(),
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

/** PUT /tenant/branding — the tenant admin's half (theme while unlocked, terms, menu). */
export const tenantBrandingUpdateSchema = z.object({
  preset: z.enum(BRAND_PRESET_IDS).nullable().optional(),
  seed_hex: seedHex.nullable().optional(),
  font: z.enum(BRAND_FONT_IDS).nullable().optional(),
  default_mode: z.enum(THEME_MODE_IDS).optional(),
  terms: brandTermsSchema.optional(),
  nav_overrides: navOverridesSchema.optional(),
}).strict();
export type TenantBrandingUpdateInput = z.infer<typeof tenantBrandingUpdateSchema>;

/** PUT /sa/tenants/:id/branding — Super Admin's half (theme + lock + names). */
export const saBrandingUpdateSchema = z.object({
  preset: z.enum(BRAND_PRESET_IDS).nullable().optional(),
  seed_hex: seedHex.nullable().optional(),
  font: z.enum(BRAND_FONT_IDS).nullable().optional(),
  default_mode: z.enum(THEME_MODE_IDS).optional(),
  theme_locked: z.boolean().optional(),
  product_names: productNamesSchema.optional(),
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
