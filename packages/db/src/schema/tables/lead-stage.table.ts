import { uuid, text, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lmsSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/26 — N-6 Half B). Unique per (tenant_id, name).
export const leadStageTable = lmsSchema.table('lead_stage', {
  id:               uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:         uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  label:            text('label').notNull(),
  description:      text('description'),
  sortOrder:        integer('sort_order').notNull().default(0),
  followupRequired: boolean('followup_required').notNull().default(false),
  isRejected:       boolean('is_rejected').notNull().default(false),
  isTerminated:     boolean('is_terminated').notNull().default(false),
  isActive:         boolean('is_active').notNull().default(true),
});
