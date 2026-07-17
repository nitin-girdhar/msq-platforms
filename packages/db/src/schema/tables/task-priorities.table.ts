import { uuid, text, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { taskSchema } from '../pg-schemas';

// Global lookup (no RLS) — low / medium / high / urgent, ordered by sort_order.
export const taskPrioritiesTable = taskSchema.table('task_priorities', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  name:        text('name').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  sortOrder:   integer('sort_order').notNull().default(0),
  isActive:    boolean('is_active').notNull().default(true),
});
