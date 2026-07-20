import { uuid, boolean, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { shiftsTable } from './shifts.table';

// Effective-dated user→shift mapping. No overlapping assignments per user
// (gist exclusion enforced in db_scripts/13).
export const shiftAssignmentsTable = hrSchema.table('shift_assignments', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:         uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  orgId:          uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  shiftId:        uuid('shift_id').notNull().references(() => shiftsTable.id, { onDelete: 'restrict' }),
  effectiveFrom:  date('effective_from').notNull(),
  effectiveTo:    date('effective_to'),
  isActive:       boolean('is_active').notNull().default(true),
  isDeleted:      boolean('is_deleted').notNull().default(false),
  deletedAt:      timestamp('deleted_at', { withTimezone: true }),
  deletedBy:      uuid('deleted_by'),
  createdBy:      uuid('created_by'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
