import { uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { tasksTable } from './tasks.table';
import { usersTable } from './users.table';

// Append-only comment thread (no updated_at). app_user may SELECT + INSERT own
// author rows; UPDATE/DELETE are revoked for non-service roles.
export const taskCommentsTable = taskSchema.table('task_comments', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  taskId:     uuid('task_id').notNull().references(() => tasksTable.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  body:       text('body').notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
