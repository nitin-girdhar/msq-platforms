import { uuid, boolean, smallint, time, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { shiftsTable } from './shifts.table';

// Ordered in-day slots of a split shift (hr.shifts.is_split), e.g. 09:00-13:00
// and 17:00-21:00. UNIQUE (shift_id, seq) among non-deleted.
//
// Nesting inside the parent shift's window and non-overlap between segments are
// enforced in the service layer, not by table constraints: the first is
// cross-table and the second cross-row, and a night-shift segment legitimately
// wraps midnight so an inverted range is valid rather than an error.
export const shiftSegmentsTable = hrSchema.table('shift_segments', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  shiftId:    uuid('shift_id').notNull().references(() => shiftsTable.id, { onDelete: 'cascade' }),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  seq:        smallint('seq').notNull(),
  startTime:  time('start_time').notNull(),
  endTime:    time('end_time').notNull(),
  isActive:   boolean('is_active').notNull().default(true),
  isDeleted:  boolean('is_deleted').notNull().default(false),
  deletedAt:  timestamp('deleted_at', { withTimezone: true }),
  deletedBy:  uuid('deleted_by'),
  createdBy:  uuid('created_by'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
