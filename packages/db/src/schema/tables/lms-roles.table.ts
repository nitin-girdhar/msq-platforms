import { uuid, text, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lmsSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Per-product LMS role catalog (own rank scale). Tenant-scoped lookup (RLS,
// db_scripts/22), seeded in db_scripts/17. Unique per (tenant_id, name), not
// globally. See docs/DB_model.md → lms.roles.
export const lmsRolesTable = lmsSchema.table('roles', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  rank:        integer('rank').notNull().default(0),
  sortOrder:   integer('sort_order').notNull().default(0),
  isActive:    boolean('is_active').notNull().default(true),
});
