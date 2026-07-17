import { uuid, text, boolean, integer, timestamp, date } from 'drizzle-orm/pg-core';
import { hrSchema } from '../pg-schemas';

// Today's org attendance: active employees LEFT JOINed to their attendance_days
// row for CURRENT_DATE; unmatched employees surface as 'not_marked'.
export const vwOrgAttendanceToday = hrSchema.view('vw_org_attendance_today', {
  orgId:          uuid('org_id').notNull(),
  userId:         uuid('user_id').notNull(),
  userFullName:   text('user_full_name'),
  userEmail:      text('user_email'),
  workDate:       date('work_date'),
  firstIn:        timestamp('first_in', { withTimezone: true }),
  lastOut:        timestamp('last_out', { withTimezone: true }),
  workedMinutes:  integer('worked_minutes'),
  statusName:     text('status_name'),
  statusLabel:    text('status_label'),
  isLate:         boolean('is_late'),
  isEarlyExit:    boolean('is_early_exit'),
}).existing();
