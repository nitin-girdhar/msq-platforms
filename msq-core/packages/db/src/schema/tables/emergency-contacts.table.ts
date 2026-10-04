import { uuid, text, boolean, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// Emergency contacts (schema 1.60.0). Same privacy shape as employee_personal. At most one
// primary contact per person (partial unique index uix_emergency_contacts_primary).
export const emergencyContactsTable = hrSchema.table('emergency_contacts', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:     uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  name:       text('name').notNull(),
  relation:   text('relation').notNull(),
  phone:      text('phone').notNull(),
  isPrimary:  boolean('is_primary').notNull().default(false),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
