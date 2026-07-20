import { uuid, text, integer, boolean, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lmsSchema } from '../pg-schemas';
import { leadStageTable } from './lead-stage.table';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/26 — N-6 Half B). tenant_id denormalized from
// the parent stage; unique per (stage_id, name) (stage_id already implies tenant).
export const leadStageOutcomeTable = lmsSchema.table('lead_stage_outcome', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:        uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  stageId:         uuid('stage_id').notNull().references(() => leadStageTable.id, { onDelete: 'restrict' }),
  name:            text('name').notNull(),
  label:           text('label').notNull(),
  description:     text('description'),
  requiresComment: boolean('requires_comment').notNull().default(false),
  sortOrder:       integer('sort_order').notNull().default(0),
  isActive:        boolean('is_active').notNull().default(true),
}, (t) => ({
  uqLeadStageOutcomeStageName: unique('uq_lead_stage_outcome_stage_name').on(t.stageId, t.name),
}));
