import { uuid, text, bigint, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';

// Routes an incoming Meta lead (Page+Form) to the owning org. form_id, when
// set, is the authoritative key (globally unique in Meta's system, and a
// form can only ever belong to one Page) and narrows routing to that one
// form. form_id may be NULL for a page-level subscription: every leadgen
// form on that Page routes to this row's org unless a more specific
// form_id row exists for the same page (exact match wins). At most one
// active page-level (form_id IS NULL) row is allowed per page — see the
// partial unique index in db_scripts/02_tables_core.sql.
export const metaPageFormOrgMapTable = extSchema.table('meta_page_form_org_map', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:  uuid('tenant_id').notNull().references(() => tenantsTable.id),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id),
  pageId:    bigint('page_id', { mode: 'bigint' }).notNull(),
  formId:    bigint('form_id', { mode: 'bigint' }),
  platform:  text('platform').notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqPageForm: unique('uq_meta_page_form_org_map').on(t.pageId, t.formId),
}));
