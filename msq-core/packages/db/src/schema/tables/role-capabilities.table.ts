import { uuid, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { userRolesTable } from './user-roles.table';
import { capabilitiesTable } from './capabilities.table';

// tenant_id NULL = the platform default grant (shared by every tenant);
// tenant_id set = that tenant's override of the same (role, capability) pair,
// which wins per iam.fn_role_capability_matrix's resolution order. is_granted
// FALSE is how a tenant revokes a default without deleting the platform row.
//
// RLS note (db_scripts/06_rls.sql admin_tenant_config_policy): writes are
// scoped by the ACTOR'S CURRENT ORG's tenant (app.current_org_id), not
// app.current_tenant_id directly — unlike the newer N-6 product-lookup
// policies. A write on this table must run with app.current_org_id set to an
// org under the target tenant; see capabilities.repository.ts.
export const roleCapabilitiesTable = iamSchema.table('role_capabilities', {
  id:           uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:     uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  roleId:       uuid('role_id').notNull().references(() => userRolesTable.id, { onDelete: 'cascade' }),
  capabilityId: uuid('capability_id').notNull().references(() => capabilitiesTable.id, { onDelete: 'cascade' }),
  isGranted:    boolean('is_granted').notNull().default(true),
  createdBy:    uuid('created_by'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
