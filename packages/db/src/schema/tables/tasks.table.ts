import { uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { usersTable } from './users.table';
import { taskListsTable } from './task-lists.table';
import { taskStatusesTable } from './task-statuses.table';
import { taskPrioritiesTable } from './task-priorities.table';

export const tasksTable = taskSchema.table('tasks', {
  id:                uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:             uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  listId:            uuid('list_id').references(() => taskListsTable.id, { onDelete: 'set null' }),
  title:             text('title').notNull(),
  description:       text('description'),
  assigneeId:        uuid('assignee_id').references(() => usersTable.id, { onDelete: 'set null' }),
  dueAt:             timestamp('due_at', { withTimezone: true }),
  priorityId:        uuid('priority_id').references(() => taskPrioritiesTable.id, { onDelete: 'restrict' }),
  statusId:          uuid('status_id').notNull().references(() => taskStatusesTable.id, { onDelete: 'restrict' }),
  parentTaskId:      uuid('parent_task_id'),
  relatedEntityType: text('related_entity_type'),
  relatedEntityId:   uuid('related_entity_id'),
  tags:              text('tags').array().notNull().default(sql`'{}'::text[]`),
  completedAt:       timestamp('completed_at', { withTimezone: true }),
  recurrenceRule:    text('recurrence_rule'),
  isActive:          boolean('is_active').notNull().default(true),
  isDeleted:         boolean('is_deleted').notNull().default(false),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
  deletedBy:         uuid('deleted_by'),
  createdBy:         uuid('created_by'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
