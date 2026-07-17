import { uuid, text, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';

export const employmentTypesTable = hrSchema.table('employment_types', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  name:        text('name').notNull().unique(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
});
