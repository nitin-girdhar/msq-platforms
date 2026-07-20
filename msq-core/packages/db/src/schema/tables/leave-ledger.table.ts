import { uuid, text, numeric, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { leaveTypesTable } from './leave-types.table';
import { leaveRequestsTable } from './leave-requests.table';

// Append-only source of truth for leave balances. Balance = SUM(amount).
// INSERT only via the service path; no update/delete for non-service roles.
export const leaveLedgerTable = hrSchema.table('leave_ledger', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:          uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:           uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  leaveTypeId:     uuid('leave_type_id').notNull().references(() => leaveTypesTable.id, { onDelete: 'restrict' }),
  entryType:       text('entry_type').notNull(),
  amount:          numeric('amount', { precision: 6, scale: 2 }).notNull(),
  leaveRequestId:  uuid('leave_request_id').references(() => leaveRequestsTable.id, { onDelete: 'set null' }),
  period:          text('period'),
  effectiveDate:   date('effective_date').notNull(),
  note:            text('note'),
  createdBy:       uuid('created_by'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
