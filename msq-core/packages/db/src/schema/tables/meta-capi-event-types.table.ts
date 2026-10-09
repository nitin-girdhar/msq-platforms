import { integer, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { extSchema } from '../pg-schemas';

export const metaCapiEventTypesTable = extSchema.table('meta_capi_event_types', {
  id:          integer('id').generatedAlwaysAsIdentity().primaryKey(),
  code:        varchar('code', { length: 50 }).notNull().unique(),
  label:       varchar('label', { length: 100 }).notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
  sortOrder:   integer('sort_order').notNull().default(0),
  /** Position in the funnel (1.79.0); NULL = outside the sequence (negative events, the retired 'Other'). */
  funnelRank:  integer('funnel_rank'),
  /** A negative signal (e.g. unqualified): sent when reached, never queued as a skipped stage. */
  isNegative:  boolean('is_negative').notNull().default(false),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
