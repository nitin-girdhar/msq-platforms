import { uuid, text, boolean, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { shiftsTable } from './shifts.table';

// Peer shift swaps (schema 1.61.0). Two employees trade shifts for ONE future day: the
// requester asks, the peer consents, the requester's approver decides; approval rewrites
// both people's hr.shift_assignments in one transaction. Privacy: only the participants
// may read a request (participant policy for app_user, tenant_admin policy, no org-wide
// policy); every write runs in the service transaction.
// status: pending_peer | pending_manager | approved | rejected | declined | cancelled.
export const shiftSwapRequestsTable = hrSchema.table('shift_swap_requests', {
  id:               uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:            uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  requesterId:      uuid('requester_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  peerId:           uuid('peer_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  swapDate:         date('swap_date').notNull(),
  requesterShiftId: uuid('requester_shift_id').notNull().references(() => shiftsTable.id, { onDelete: 'restrict' }),
  peerShiftId:      uuid('peer_shift_id').notNull().references(() => shiftsTable.id, { onDelete: 'restrict' }),
  reason:           text('reason').notNull(),
  status:           text('status').notNull().default('pending_peer'),
  managerId:        uuid('manager_id').references(() => usersTable.id, { onDelete: 'set null' }),
  peerRespondedAt:  timestamp('peer_responded_at', { withTimezone: true }),
  actedBy:          uuid('acted_by').references(() => usersTable.id, { onDelete: 'set null' }),
  actedAt:          timestamp('acted_at', { withTimezone: true }),
  approverComment:  text('approver_comment'),
  isActive:         boolean('is_active').notNull().default(true),
  isDeleted:        boolean('is_deleted').notNull().default(false),
  deletedAt:        timestamp('deleted_at', { withTimezone: true }),
  deletedBy:        uuid('deleted_by'),
  createdBy:        uuid('created_by'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
