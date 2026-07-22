import { uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { tenantsTable } from './tenants.table';

// Tier C: departments moved from hr.departments → iam.departments (tenant-scoped)
// so roles in every product can belong to a department. tenant_id scopes them per
// tenant; org_id NULL = a tenant-wide department shared by all the tenant's orgs.
export const departmentsTable = iamSchema.table('departments', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  orgId:       uuid('org_id').references(() => organizationsTable.id, { onDelete: 'restrict' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
  isDeleted:   boolean('is_deleted').notNull().default(false),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  deletedBy:   uuid('deleted_by'),
  createdBy:   uuid('created_by'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
