import { uuid, text, bigint, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';

// Routes an incoming Meta lead (Page+Form) to the owning org. form_id is the
// authoritative key (globally unique in Meta's system, and a form can only
// ever belong to one Page); page_id is retained for reference/validation and
// to auto-attribute new forms created on a Page already mapped to an org.
export const metaPageFormOrgMapTable = extSchema.table('meta_page_form_org_map', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:  uuid('tenant_id').notNull().references(() => tenantsTable.id),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id),
  pageId:    bigint('page_id', { mode: 'bigint' }).notNull(),
  formId:    bigint('form_id', { mode: 'bigint' }).notNull(),
  platform:  text('platform').notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqPageForm: unique('uq_meta_page_form_org_map').on(t.pageId, t.formId),
}));
