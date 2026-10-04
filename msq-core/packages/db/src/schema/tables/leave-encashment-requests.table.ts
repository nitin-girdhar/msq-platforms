import { uuid, text, boolean, timestamp, numeric, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { leaveTypesTable } from './leave-types.table';
import { leaveLedgerTable } from './leave-ledger.table';

// Encashment of unused leave (schema 1.64.0). Approval writes a negative 'encashment' ledger entry.
// One open request per person and leave type. Same approver rule as comp-off.
export const leaveEncashmentRequestsTable = hrSchema.table('leave_encashment_requests', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:          uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:           uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  leaveTypeId:     uuid('leave_type_id').notNull().references(() => leaveTypesTable.id, { onDelete: 'restrict' }),
  days:            numeric('days', { precision: 5, scale: 2 }).notNull(),
  reason:          text('reason'),
  // pending | approved | rejected | cancelled
  status:          text('status').notNull().default('pending'),
  approverId:      uuid('approver_id').references(() => usersTable.id, { onDelete: 'set null' }),
  actedBy:         uuid('acted_by').references(() => usersTable.id, { onDelete: 'set null' }),
  actedAt:         timestamp('acted_at', { withTimezone: true }),
  approverComment: text('approver_comment'),
  ledgerEntryId:   uuid('ledger_entry_id').references(() => leaveLedgerTable.id, { onDelete: 'set null' }),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
