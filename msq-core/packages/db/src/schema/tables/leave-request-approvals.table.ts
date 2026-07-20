import { uuid, text, smallint, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { leaveRequestsTable } from './leave-requests.table';
import { organizationsTable } from './organizations.table';
import { usersTable } from './users.table';

// One row per approval level. Created via the service path when a request is
// submitted; the approver acts (approve/reject) on their own row.
export const leaveRequestApprovalsTable = hrSchema.table('leave_request_approvals', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  leaveRequestId:  uuid('leave_request_id').notNull().references(() => leaveRequestsTable.id, { onDelete: 'cascade' }),
  orgId:           uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  level:           smallint('level').notNull(),
  approverId:      uuid('approver_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  action:          text('action').notNull().default('pending'),
  actedAt:         timestamp('acted_at', { withTimezone: true }),
  comment:         text('comment'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
