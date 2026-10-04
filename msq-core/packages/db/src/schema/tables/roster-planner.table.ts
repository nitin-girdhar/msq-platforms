import { uuid, text, boolean, integer, smallint, date, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { shiftsTable } from './shifts.table';

// Roster planner + document limit (schema 1.66.0). Readable by the branch; written only through
// the service transaction behind the manage capabilities.

// One row per org: the largest document upload (bytes), 100 KiB .. 3.5 MiB.
export const documentSettingsTable = hrSchema.table('document_settings', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  maxBytes:  integer('max_bytes').notNull().default(3145728),
  isActive:  boolean('is_active').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// How many people a shift needs in a branch (the planner's capacity cards).
export const shiftRequirementsTable = hrSchema.table('shift_requirements', {
  id:                uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:             uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  shiftId:           uuid('shift_id').notNull().references(() => shiftsTable.id, { onDelete: 'cascade' }),
  requiredHeadcount: smallint('required_headcount').notNull(),
  isActive:          boolean('is_active').notNull().default(true),
  isDeleted:         boolean('is_deleted').notNull().default(false),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
  deletedBy:         uuid('deleted_by'),
  createdBy:         uuid('created_by'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A Monday-dated week of the roster that HR has published.
export const rosterPublicationsTable = hrSchema.table('roster_publications', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:       uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  weekStart:   date('week_start').notNull(),
  publishedBy: uuid('published_by').references(() => usersTable.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  note:        text('note'),
  isActive:    boolean('is_active').notNull().default(true),
  isDeleted:   boolean('is_deleted').notNull().default(false),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  deletedBy:   uuid('deleted_by'),
  createdBy:   uuid('created_by'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
