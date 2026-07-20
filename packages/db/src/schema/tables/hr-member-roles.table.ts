import { uuid, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { hrSchema } from '../pg-schemas';
import { usersTable } from './users.table';
import { organizationsTable } from './organizations.table';
import { tenantsTable } from './tenants.table';
import { hrRolesTable } from './hr-roles.table';

// (user, HR, role) grant — org-grained, tenant-isolated via RLS.
// tenant_id is derived from org_id by a DB trigger; never write it directly.
// See db_scripts/17 and docs/DB_model.md → hr.member_roles.
export const hrMemberRolesTable = hrSchema.table('member_roles', {
  userId:    uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  orgId:     uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'cascade' }),
  tenantId:  uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  roleId:    uuid('role_id').notNull().references(() => hrRolesTable.id, { onDelete: 'restrict' }),
  isActive:  boolean('is_active').notNull().default(true),
  grantedBy: uuid('granted_by').references(() => usersTable.id, { onDelete: 'set null' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.orgId] }),
}));
