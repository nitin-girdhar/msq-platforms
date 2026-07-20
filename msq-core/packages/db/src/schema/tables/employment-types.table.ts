import { uuid, text, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped lookup (RLS, db_scripts/22). Unique per (tenant_id, name),
// not globally.
export const employmentTypesTable = hrSchema.table('employment_types', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
});
