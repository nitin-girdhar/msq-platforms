import { uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { userRolesTable } from './user-roles.table';

export const usersTable = iamSchema.table('users', {
  id:                  uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:               uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'restrict' }),
  firstName:           text('first_name').notNull(),
  middleName:          text('middle_name'),
  lastName:            text('last_name').notNull().default(''),
  fullName:            text('full_name').generatedAlwaysAs(
    sql`TRIM(first_name || COALESCE(' ' || NULLIF(middle_name, ''), '') || COALESCE(' ' || NULLIF(last_name, ''), ''))`,
  ),
  email:               text('email').notNull().unique(),
  mobile:              text('mobile'),
  passwordHash:        text('password_hash').notNull(),
  roleId:              uuid('role_id').notNull().references(() => userRolesTable.id, { onDelete: 'restrict' }),
  // Coarse cross-product role that survives in the shrunk JWT (P1.1). Nullable
  // until the Phase E contract makes it NOT NULL. Values: super_admin |
  // tenant_admin | org_admin | member. Drives PG-role selection + platform-wide
  // capability only; product authority lives in <product>.member_roles.
  platformRole:        text('platform_role'),
  managerId:           uuid('manager_id').references((): any => usersTable.id, { onDelete: 'set null' }),
  isActive:            boolean('is_active').notNull().default(true),
  isDeleted:           boolean('is_deleted').notNull().default(false),
  deletedAt:           timestamp('deleted_at', { withTimezone: true }),
  deletedBy:           uuid('deleted_by'),
  createdBy:           uuid('created_by'),
  forcePasswordChange: boolean('force_password_change').notNull().default(true),
  passwordChangedAt:   timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt:         timestamp('last_login_at', { withTimezone: true }),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
