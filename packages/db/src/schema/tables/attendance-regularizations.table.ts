import { uuid, text, boolean, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { attendanceStatusesTable } from './attendance-statuses.table';

// Correction requests. One open (pending) regularization per (user, work_date).
// Approvers act via the service path (hr.can_approve authority).
export const attendanceRegularizationsTable = hrSchema.table('attendance_regularizations', {
  id:                  uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:              uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:               uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  workDate:            date('work_date').notNull(),
  requestedStatusId:   uuid('requested_status_id').references(() => attendanceStatusesTable.id, { onDelete: 'restrict' }),
  requestedIn:         timestamp('requested_in', { withTimezone: true }),
  requestedOut:        timestamp('requested_out', { withTimezone: true }),
  reason:              text('reason').notNull(),
  status:              text('status').notNull().default('pending'),
  approverId:          uuid('approver_id').references(() => usersTable.id, { onDelete: 'set null' }),
  actedAt:             timestamp('acted_at', { withTimezone: true }),
  approverComment:     text('approver_comment'),
  isActive:            boolean('is_active').notNull().default(true),
  isDeleted:           boolean('is_deleted').notNull().default(false),
  deletedAt:           timestamp('deleted_at', { withTimezone: true }),
  deletedBy:           uuid('deleted_by'),
  createdBy:           uuid('created_by'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
