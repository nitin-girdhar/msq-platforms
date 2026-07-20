import { uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { leaveRequestsTable } from './leave-requests.table';
import { usersTable } from './users.table';
import { leaveRequestStatusesTable } from './leave-request-statuses.table';

// Append-only status-transition log (mirrors lms.lead_status_log). Written by
// the hr.log_leave_status_change trigger only.
export const leaveRequestStatusLogTable = hrSchema.table('leave_request_status_log', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:       uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  requestId:   uuid('request_id').notNull().references(() => leaveRequestsTable.id, { onDelete: 'cascade' }),
  changedById: uuid('changed_by_id').references(() => usersTable.id, { onDelete: 'set null' }),
  oldStatusId: uuid('old_status_id').references(() => leaveRequestStatusesTable.id, { onDelete: 'restrict' }),
  newStatusId: uuid('new_status_id').notNull().references(() => leaveRequestStatusesTable.id, { onDelete: 'restrict' }),
  note:        text('note'),
  changedAt:   timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});
