import { uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entitySchema } from '../pg-schemas';

// Immutable, versioned default catalog rows (see db_scripts/23). One table for
// every catalog; the per-catalog extras (is_terminal / is_paid / rank) are
// nullable and only set for the catalog that uses them. Append-only: a new
// default = a new `version`, never an UPDATE of an existing (catalog_key,
// version) row set — that is what keeps catalog edits from retroactively
// touching already-provisioned tenants.
export const catalogDefaultsTable = entitySchema.table('catalog_defaults', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  catalogKey:  text('catalog_key').notNull(),   // schema-qualified target, e.g. 'task.task_statuses'
  product:     text('product').notNull(),       // lms | leave | attendance | tasks
  version:     integer('version').notNull(),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  sortOrder:   integer('sort_order').notNull().default(0),
  isActive:    boolean('is_active').notNull().default(true),
  isTerminal:  boolean('is_terminal'),          // task.task_statuses only
  isPaid:      boolean('is_paid'),              // hr.leave_types only
  rank:        integer('rank'),                 // *.roles only
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
