import { uuid, text, date, numeric } from 'drizzle-orm/pg-core';
import { hrSchema } from '../pg-schemas';

// Approved leaves with user info, for team-calendar date-range queries.
export const vwTeamLeaveCalendar = hrSchema.view('vw_team_leave_calendar', {
  id:              uuid('id').notNull(),
  userId:          uuid('user_id').notNull(),
  userFullName:    text('user_full_name'),
  orgId:           uuid('org_id').notNull(),
  leaveTypeId:     uuid('leave_type_id').notNull(),
  leaveTypeName:   text('leave_type_name').notNull(),
  leaveTypeLabel:  text('leave_type_label').notNull(),
  startDate:       date('start_date').notNull(),
  endDate:         date('end_date').notNull(),
  startHalf:       text('start_half').notNull(),
  endHalf:         text('end_half').notNull(),
  daysCount:       numeric('days_count').notNull(),
}).existing();
