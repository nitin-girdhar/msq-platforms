import { uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { tasksTable } from './tasks.table';
import { usersTable } from './users.table';
import { taskStatusesTable } from './task-statuses.table';

// Append-only status-transition log (mirrors crm.lead_status_log /
// hr.leave_request_status_log). Written by the task.log_task_status_change
// trigger only — INSERT is revoked for app_user/tenant_admin.
export const taskStatusLogTable = taskSchema.table('task_status_log', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:       uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  taskId:      uuid('task_id').notNull().references(() => tasksTable.id, { onDelete: 'cascade' }),
  changedById: uuid('changed_by_id').references(() => usersTable.id, { onDelete: 'set null' }),
  oldStatusId: uuid('old_status_id').references(() => taskStatusesTable.id, { onDelete: 'restrict' }),
  newStatusId: uuid('new_status_id').notNull().references(() => taskStatusesTable.id, { onDelete: 'restrict' }),
  note:        text('note'),
  changedAt:   timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});
