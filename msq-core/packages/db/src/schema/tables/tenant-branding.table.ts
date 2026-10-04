import { uuid, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entitySchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { usersTable } from './users.table';

// entity.tenant_branding (1.57.0) — one row per tenant; absent = platform default.
// Ownership is enforced in the DB, not just here: application roles may write
// only preset / seed_hex / font / default_mode (while NOT theme_locked) and
// terms / nav_overrides (column GRANTs in db_scripts/07, lock trigger in 04).
// assets / product_names / public_key / theme_locked are Super Admin's
// (admin-service, withServiceTx).
export const tenantBrandingTable = entitySchema.table('tenant_branding', {
  tenantId:     uuid('tenant_id').primaryKey().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  // Random (v4), rotatable; used only in the login link /login?t=<publicKey>.
  publicKey:    uuid('public_key').notNull().default(sql`gen_random_uuid()`),
  // DB CHECKs mirror @platform/ui-kit/theme presets.ts (THEME_PRESETS / BRAND_FONTS / THEME_MODES).
  preset:       text('preset'),
  seedHex:      text('seed_hex'),
  font:         text('font'),
  defaultMode:  text('default_mode').notNull().default('light'),
  themeLocked:  boolean('theme_locked').notNull().default(false),
  // { "<slot>": { key, content_type, bytes, updated_at } }, slot = logo | logo_dark | mark | favicon | app_icon
  assets:       jsonb('assets').notNull().default({}),
  productNames: jsonb('product_names').notNull().default({}),
  terms:        jsonb('terms').notNull().default({}),
  navOverrides: jsonb('nav_overrides').notNull().default({}),
  updatedBy:    uuid('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
  metadata:     jsonb('metadata').notNull().default({}),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
