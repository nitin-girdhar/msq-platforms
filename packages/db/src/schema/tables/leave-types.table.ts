import { uuid, text, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';

export const leaveTypesTable = hrSchema.table('leave_types', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  name:        text('name').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  isPaid:      boolean('is_paid').notNull().default(true),
  sortOrder:   integer('sort_order'),
  isActive:    boolean('is_active').notNull().default(true),
});
