import { uuid, text, boolean, timestamp, date, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { leaveTypesTable } from './leave-types.table';
import { leaveLedgerTable } from './leave-ledger.table';

// Compensatory-off claims (schema 1.59.0). An employee who worked a day off claims
// a day (or half) back; the level-1 approver — or an authorized override — decides
// it. Approval credits hr.leave_ledger and stamps expires_on; a nightly job lapses
// the credit once expired. One live claim per (user, worked_date).
// Decisions run in the service transaction (the approver is not the row's owner).
export const compOffClaimsTable = hrSchema.table('comp_off_claims', {
  id:               uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:           uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:            uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  workedDate:       date('worked_date').notNull(),
  // 0.5 or 1.0 (CHECK chk_comp_off_claims_days).
  days:             numeric('days', { precision: 3, scale: 1 }).notNull(),
  reason:           text('reason').notNull(),
  status:           text('status').notNull().default('pending'),
  approverId:       uuid('approver_id').references(() => usersTable.id, { onDelete: 'set null' }),
  actedBy:          uuid('acted_by').references(() => usersTable.id, { onDelete: 'set null' }),
  actedAt:          timestamp('acted_at', { withTimezone: true }),
  approverComment:  text('approver_comment'),
  leaveTypeId:      uuid('leave_type_id').references(() => leaveTypesTable.id, { onDelete: 'restrict' }),
  ledgerEntryId:    uuid('ledger_entry_id').references(() => leaveLedgerTable.id, { onDelete: 'set null' }),
  expiresOn:        date('expires_on'),
  lapsedAt:         timestamp('lapsed_at', { withTimezone: true }),
  isActive:         boolean('is_active').notNull().default(true),
  isDeleted:        boolean('is_deleted').notNull().default(false),
  deletedAt:        timestamp('deleted_at', { withTimezone: true }),
  deletedBy:        uuid('deleted_by'),
  createdBy:        uuid('created_by'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
