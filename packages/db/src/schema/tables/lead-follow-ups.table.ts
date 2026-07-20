import { uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lmsSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { marketingLeadsTable } from './marketing-leads.table';
import { usersTable } from './users.table';
import { followUpStatusesTable } from './follow-up-statuses.table';
import { leadStageTable } from './lead-stage.table';
import { leadStageOutcomeTable } from './lead-stage-outcome.table';

export const leadFollowUpsTable = lmsSchema.table('lead_follow_ups', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:          uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  leadId:         uuid('lead_id').notNull().references(() => marketingLeadsTable.id, { onDelete: 'cascade' }),
  assignedUserId: uuid('assigned_user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  statusId:       uuid('status_id').notNull().references(() => followUpStatusesTable.id, { onDelete: 'restrict' }),
  stageId:        uuid('stage_id').references(() => leadStageTable.id, { onDelete: 'restrict' }),
  outcomeId:      uuid('outcome_id').references(() => leadStageOutcomeTable.id, { onDelete: 'restrict' }),
  scheduledAt:    timestamp('scheduled_at', { withTimezone: true }).notNull(),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
  notes:          text('notes'),
  isDeleted:      boolean('is_deleted').notNull().default(false),
  deletedAt:      timestamp('deleted_at', { withTimezone: true }),
  deletedBy:      uuid('deleted_by'),
  createdBy:      uuid('created_by'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
