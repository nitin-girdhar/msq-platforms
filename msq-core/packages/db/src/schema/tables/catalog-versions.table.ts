import { text, integer, timestamp } from 'drizzle-orm/pg-core';
import { entitySchema } from '../pg-schemas';

// Which default-catalog version a NEW tenant is seeded from, and which
// licensed modules gate it (`modules` — seed if the tenant has ANY active
// module in this array). Editing a catalog for FUTURE tenants = insert
// version N+1 rows into catalog_defaults and bump current_version here.
export const catalogVersionsTable = entitySchema.table('catalog_versions', {
  catalogKey:     text('catalog_key').primaryKey(),   // schema-qualified target table
  product:        text('product').notNull(),
  modules:        text('modules').array().notNull(),
  currentVersion: integer('current_version').notNull(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
