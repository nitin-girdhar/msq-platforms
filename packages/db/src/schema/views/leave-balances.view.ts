import { uuid, text, numeric } from 'drizzle-orm/pg-core';
import { hrSchema } from '../pg-schemas';

// Per (user, org, leave_type) running balance = SUM(ledger.amount).
export const vwLeaveBalances = hrSchema.view('vw_leave_balances', {
  userId:          uuid('user_id').notNull(),
  orgId:           uuid('org_id').notNull(),
  leaveTypeId:     uuid('leave_type_id').notNull(),
  leaveTypeName:   text('leave_type_name').notNull(),
  leaveTypeLabel:  text('leave_type_label').notNull(),
  balance:         numeric('balance'),
}).existing();
