import { uuid, text, boolean, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hrSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/08_rls.sql) as of 1.26.0, matching its three
// sibling HR lookups. Provisioned per tenant by entity.seed_tenant_defaults()
// from the registry in reference_data/07_catalog_registry.sql.
//
// `name` is a MACHINE vocabulary ('draft'/'pending'/'approved'/...):
// hr.check_leave_request_completion() and the approval flow key on it. A
// tenant may relabel a status; renaming or removing one breaks leave approval.
export const leaveRequestStatusesTable = hrSchema.table('leave_request_statuses', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
}, (t) => ({
  uqLeaveRequestStatusesTenantName: unique('uq_leave_request_statuses_tenant_name').on(t.tenantId, t.name),
}));
