import { uuid, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entitySchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { usersTable } from './users.table';

// entity.tenant_branding (1.57.0) — one row per tenant; absent = platform default.
// Ownership is enforced in the DB, not just here: since 1.73.0 application roles may
// write ONLY preset / seed_hex / font / default_mode / color_overrides (while NOT theme_locked) — column
// GRANTs in db_scripts/07, lock trigger in 04. assets / product_names / terms /
// nav_overrides / locale_config / public_key / theme_locked are Super Admin's
// (identity-service, withServiceTx).
export const tenantBrandingTable = entitySchema.table('tenant_branding', {
  tenantId:     uuid('tenant_id').primaryKey().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  // Random (v4), rotatable; used only in the login link /login?t=<publicKey>.
  publicKey:    uuid('public_key').notNull().default(sql`gen_random_uuid()`),
  // DB CHECKs mirror @platform/ui-kit/theme presets.ts (THEME_PRESETS / BRAND_FONTS / THEME_MODES).
  preset:       text('preset'),
  seedHex:      text('seed_hex'),
  font:         text('font'),
  defaultMode:  text('default_mode').notNull().default('light'),
  // Sparse hand-tuned colour roles (1.75.0): { light: { <role>: '#rrggbb' }, dark: {...} }. Part of
  // the theme: tenant-writable while unlocked; a user's own override lives in user_preferences.theme.
  colorOverrides: jsonb('color_overrides').notNull().default({}),
  themeLocked:  boolean('theme_locked').notNull().default(false),
  // { "<slot>": { key, content_type, bytes, updated_at } }, slot in BRAND_ASSET_SLOTS (13, 1.73.0);
  // key = tenant-first blob key `<tenantId>/branding/<slot>/<epochMs>.<ext>`.
  assets:       jsonb('assets').notNull().default({}),
  productNames: jsonb('product_names').notNull().default({}),
  terms:        jsonb('terms').notNull().default({}),
  navOverrides: jsonb('nav_overrides').notNull().default({}),
  // Regional formats (1.73.0), Super Admin managed; display only. {} = platform default.
  localeConfig: jsonb('locale_config').notNull().default({}),
  // Bumped by trigger on every UPDATE (no role can write it) - cache key.
  brandingVersion: integer('branding_version').notNull().default(1),
  updatedBy:    uuid('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
  metadata:     jsonb('metadata').notNull().default({}),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
