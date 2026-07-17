import { uuid, text, date, numeric, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { leaveTypesTable } from './leave-types.table';
import { leaveRequestStatusesTable } from './leave-request-statuses.table';

export const leaveRequestsTable = hrSchema.table('leave_requests', {
  id:           uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:       uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:        uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  leaveTypeId:  uuid('leave_type_id').notNull().references(() => leaveTypesTable.id, { onDelete: 'restrict' }),
  startDate:    date('start_date').notNull(),
  endDate:      date('end_date').notNull(),
  startHalf:    text('start_half').notNull().default('full'),
  endHalf:      text('end_half').notNull().default('full'),
  daysCount:    numeric('days_count', { precision: 5, scale: 2 }).notNull(),
  reason:       text('reason'),
  statusId:     uuid('status_id').notNull().references(() => leaveRequestStatusesTable.id, { onDelete: 'restrict' }),
  documentUrl:  text('document_url'),
  // Maintained by trigger from status_id: TRUE while pending/approved.
  isOpen:       boolean('is_open').notNull().default(true),
  isActive:     boolean('is_active').notNull().default(true),
  isDeleted:    boolean('is_deleted').notNull().default(false),
  deletedAt:    timestamp('deleted_at', { withTimezone: true }),
  deletedBy:    uuid('deleted_by'),
  createdBy:    uuid('created_by'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
