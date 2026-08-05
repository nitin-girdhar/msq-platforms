import { uuid, text, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';

// Per-employee geofence exemptions: who may punch outside the office radius,
// between which dates, and why. 'remote_role' is a rotating/field role tied to
// no location; 'wfh' is an approved work-from-home stretch. Effective-dated with
// a gist no-overlap exclusion scoped BY TYPE, so one person may hold both.
export const attendanceGeoExceptionsTable = hrSchema.table('attendance_geo_exceptions', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:         uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:          uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  exceptionType:  text('exception_type').notNull(),
  effectiveFrom:  date('effective_from').notNull(),
  effectiveTo:    date('effective_to'),
  reason:         text('reason').notNull(),
  isActive:       boolean('is_active').notNull().default(true),
  isDeleted:      boolean('is_deleted').notNull().default(false),
  deletedAt:      timestamp('deleted_at', { withTimezone: true }),
  deletedBy:      uuid('deleted_by'),
  createdBy:      uuid('created_by'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
