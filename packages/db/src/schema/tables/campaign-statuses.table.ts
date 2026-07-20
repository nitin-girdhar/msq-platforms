import { uuid, text, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { marketingSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/26 — N-6 Half B). Unique per (tenant_id, name).
export const campaignStatusesTable = marketingSchema.table('campaign_statuses', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
});
