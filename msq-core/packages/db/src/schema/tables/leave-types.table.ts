import { uuid, text, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped lookup (RLS, db_scripts/22). Unique per (tenant_id, name),
// not globally.
export const leaveTypesTable = hrSchema.table('leave_types', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isPaid:      boolean('is_paid').notNull().default(true),
  sortOrder:   integer('sort_order'),
  isActive:    boolean('is_active').notNull().default(true),
});
