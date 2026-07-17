import { uuid, text, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskSchema } from '../pg-schemas';

// Global lookup (no RLS) — same shape as crm.lead_stage. is_terminal marks the
// closing statuses (done, cancelled).
export const taskStatusesTable = taskSchema.table('task_statuses', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  name:        text('name').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  isTerminal:  boolean('is_terminal').notNull().default(false),
  sortOrder:   integer('sort_order').notNull().default(0),
  isActive:    boolean('is_active').notNull().default(true),
});
