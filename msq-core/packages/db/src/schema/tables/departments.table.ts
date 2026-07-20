import { uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';

export const departmentsTable = hrSchema.table('departments', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  name:      text('name').notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
