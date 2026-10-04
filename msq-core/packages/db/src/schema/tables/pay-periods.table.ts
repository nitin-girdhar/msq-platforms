import { uuid, text, boolean, timestamp, date, numeric, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// One row per (org, month); an absent row means the month is open (schema 1.62.0).
// A locked month refuses new attendance corrections and recomputes for it.
// Readable by anyone in the branch (a lock is not secret); written only via the service.
export const payPeriodsTable = hrSchema.table('pay_periods', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  // First day of the month (CHECK chk_pay_periods_first_of_month).
  period:    date('period').notNull(),
  // open | locked
  status:    text('status').notNull().default('open'),
  lockedBy:  uuid('locked_by').references(() => usersTable.id, { onDelete: 'set null' }),
  lockedAt:  timestamp('locked_at', { withTimezone: true }),
  isActive:  boolean('is_active').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
