import { uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';

// The global, platform-shipped capability catalog (tool -> page -> tab ->
// operation -> scope). Seeded via db_scripts/07 and generated into
// @platform/rbac's CAPABILITY map — that map has keys only, no label/kind/
// parent, so a UI needs this table read directly (see capabilities router in
// admin-service). Read-only from the app: nobody may INSERT/UPDATE/DELETE
// this table outside migrations (db_scripts/06_rls.sql catalog_read_policy).
export const capabilitiesTable = iamSchema.table('capabilities', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  key:         text('key').notNull().unique(),
  kind:        text('kind').notNull(), // 'tool' | 'page' | 'tab' | 'operation' | 'scope'
  parentKey:   text('parent_key'),
  label:       text('label').notNull(),
  description: text('description'),
  sortOrder:   integer('sort_order').notNull().default(0),
  isActive:    boolean('is_active').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
