import { uuid, text, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped lookup (RLS, db_scripts/22) — same shape as lms.lead_stage.
// is_terminal marks the closing statuses (done, cancelled). Unique per
// (tenant_id, name), not globally.
export const taskStatusesTable = taskSchema.table('task_statuses', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isTerminal:  boolean('is_terminal').notNull().default(false),
  sortOrder:   integer('sort_order').notNull().default(0),
  isActive:    boolean('is_active').notNull().default(true),
});
