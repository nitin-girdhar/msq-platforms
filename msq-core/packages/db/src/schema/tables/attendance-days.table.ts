import { uuid, text, boolean, integer, timestamp, date, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { attendanceStatusesTable } from './attendance-statuses.table';
import { leaveRequestsTable } from './leave-requests.table';

// One resolved row per user per date. Upserted by the service path (live punch)
// and the nightly resolution job. Writes are service-only. UNIQUE (user, work_date).
export const attendanceDaysTable = hrSchema.table('attendance_days', {
  id:                uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:            uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:             uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  workDate:          date('work_date').notNull(),
  firstIn:           timestamp('first_in', { withTimezone: true }),
  lastOut:           timestamp('last_out', { withTimezone: true }),
  workedMinutes:     integer('worked_minutes'),
  statusId:          uuid('status_id').notNull().references(() => attendanceStatusesTable.id, { onDelete: 'restrict' }),
  isLate:            boolean('is_late').notNull().default(false),
  isEarlyExit:       boolean('is_early_exit').notNull().default(false),
  leaveRequestId:    uuid('leave_request_id').references(() => leaveRequestsTable.id, { onDelete: 'set null' }),
  resolvedAt:        timestamp('resolved_at', { withTimezone: true }),
  resolutionSource:  text('resolution_source'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqAttendanceDaysUserDate: unique('uq_attendance_days_user_date').on(t.userId, t.workDate),
}));
