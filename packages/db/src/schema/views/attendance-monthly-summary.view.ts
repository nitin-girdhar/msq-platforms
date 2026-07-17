import { uuid, text, numeric, bigint } from 'drizzle-orm/pg-core';
import { hrSchema } from '../pg-schemas';

// Per (user, org, month) status counts, late count, avg worked_minutes.
// Payroll-export source.
export const vwAttendanceMonthlySummary = hrSchema.view('vw_attendance_monthly_summary', {
  orgId:             uuid('org_id').notNull(),
  userId:            uuid('user_id').notNull(),
  userFullName:      text('user_full_name'),
  userEmail:         text('user_email'),
  month:             text('month'),
  presentCount:      bigint('present_count', { mode: 'number' }),
  absentCount:       bigint('absent_count', { mode: 'number' }),
  halfDayCount:      bigint('half_day_count', { mode: 'number' }),
  onLeaveCount:      bigint('on_leave_count', { mode: 'number' }),
  holidayCount:      bigint('holiday_count', { mode: 'number' }),
  weeklyOffCount:    bigint('weekly_off_count', { mode: 'number' }),
  wfhCount:          bigint('wfh_count', { mode: 'number' }),
  lateCount:         bigint('late_count', { mode: 'number' }),
  earlyExitCount:    bigint('early_exit_count', { mode: 'number' }),
  avgWorkedMinutes:  numeric('avg_worked_minutes'),
}).existing();
