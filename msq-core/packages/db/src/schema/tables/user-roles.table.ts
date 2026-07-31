import { uuid, text, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { iamSchema } from '../pg-schemas';

// Mirrors iam.user_roles in db_scripts/02_schema.sql. Both tenant_id and
// department_id were missing here, which is why admin-service could neither
// filter the role list by tenant nor set the tenant on a role it created —
// every role made from the admin console silently became a global row.
//
// tenant_id NULL is now reserved for `super_admin` alone
// (_migrations/23_tenant_scope_admin_roles.sql); every other role belongs to a
// tenant.
export const userRolesTable = iamSchema.table('user_roles', {
  id:           uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:     uuid('tenant_id'),
  departmentId: uuid('department_id'),
  // NOT globally unique, despite what this model used to declare. The database
  // uses two PARTIAL indexes instead: (name) WHERE tenant_id IS NULL for the
  // global row, and (tenant_id, name) for tenant rows — so the same role name
  // legitimately exists once per tenant. A plain .unique() here would make any
  // generated migration try to add a constraint the data already violates.
  name:         text('name').notNull(),
  label:        text('label').notNull(),
  description:  text('description'),
  rank:         integer('rank').notNull().default(0),
  isActive:     boolean('is_active').notNull().default(true),
});
