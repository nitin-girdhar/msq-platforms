import { uuid, text, date, numeric, boolean, smallint, timestamp } from 'drizzle-orm/pg-core';
import { hrSchema } from '../pg-schemas';

// Requests joined with requester name, type/status labels, latest approval.
export const vwLeaveRequestsEnriched = hrSchema.view('vw_leave_requests_enriched', {
  id:                    uuid('id').notNull(),
  userId:                uuid('user_id').notNull(),
  userFullName:          text('user_full_name'),
  userEmail:             text('user_email'),
  orgId:                 uuid('org_id').notNull(),
  leaveTypeId:           uuid('leave_type_id').notNull(),
  leaveTypeName:         text('leave_type_name').notNull(),
  leaveTypeLabel:        text('leave_type_label').notNull(),
  startDate:             date('start_date').notNull(),
  endDate:               date('end_date').notNull(),
  startHalf:             text('start_half').notNull(),
  endHalf:               text('end_half').notNull(),
  daysCount:             numeric('days_count').notNull(),
  reason:                text('reason'),
  statusId:              uuid('status_id').notNull(),
  statusName:            text('status_name').notNull(),
  statusLabel:           text('status_label').notNull(),
  documentUrl:           text('document_url'),
  isOpen:                boolean('is_open').notNull(),
  latestApprovalLevel:   smallint('latest_approval_level'),
  latestApproverId:      uuid('latest_approver_id'),
  latestApprovalAction:  text('latest_approval_action'),
  latestApprovalActedAt: timestamp('latest_approval_acted_at', { withTimezone: true }),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();
