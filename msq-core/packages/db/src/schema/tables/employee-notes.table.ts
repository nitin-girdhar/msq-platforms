import { uuid, text, boolean, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// HR timeline notes about an employee (schema 1.60.0). No app_user policy at all: a note
// about an employee is not that employee's to read, nor their colleagues'. Read and written
// only through the service transaction, behind hr.employees.profile360.view / notes.manage.
export const employeeNotesTable = hrSchema.table('employee_notes', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:     uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  authorId:   uuid('author_id').references(() => usersTable.id, { onDelete: 'set null' }),
  // note | appraisal | promotion | transfer | warning | other (CHECK chk_employee_notes_kind)
  kind:       text('kind').notNull().default('note'),
  body:       text('body').notNull(),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
