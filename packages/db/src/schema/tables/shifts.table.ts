import { uuid, text, boolean, smallint, time, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';

// Org-scoped shift definitions. UNIQUE (org_id, name) among non-deleted.
export const shiftsTable = hrSchema.table('shifts', {
  id:                 uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:              uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  name:               text('name').notNull(),
  startTime:          time('start_time').notNull(),
  endTime:            time('end_time').notNull(),
  graceMinutes:       smallint('grace_minutes').notNull().default(10),
  minHalfDayMinutes:  smallint('min_half_day_minutes').notNull().default(240),
  minFullDayMinutes:  smallint('min_full_day_minutes').notNull().default(480),
  isNightShift:       boolean('is_night_shift').notNull().default(false),
  isActive:           boolean('is_active').notNull().default(true),
  isDeleted:          boolean('is_deleted').notNull().default(false),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
  deletedBy:          uuid('deleted_by'),
  createdBy:          uuid('created_by'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
