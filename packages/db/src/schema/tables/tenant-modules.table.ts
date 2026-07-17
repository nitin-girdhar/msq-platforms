import { uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entitySchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

export const tenantModulesTable = entitySchema.table('tenant_modules', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:  uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  module:    text('module').notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
