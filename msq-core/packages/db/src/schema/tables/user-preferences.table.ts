import { uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { iamSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { tenantsTable } from './tenants.table';

// iam.user_preferences (1.57.0) — personal; RLS is user_id-only for every role.
// theme: { preset | seed_hex, font, mode } or NULL ("use the company theme").
export const userPreferencesTable = iamSchema.table('user_preferences', {
  userId:    uuid('user_id').primaryKey().references(() => usersTable.id, { onDelete: 'cascade' }),
  tenantId:  uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  theme:     jsonb('theme'),
  metadata:  jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
