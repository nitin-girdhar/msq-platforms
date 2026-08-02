import { uuid, text, boolean, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { marketingSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/08_rls.sql). tenant_id IS NULL marks a
// platform template row, cloned per tenant by
// entity.seed_tenant_lms_catalogs() -- so it is NULLABLE, not notNull as this
// mirror previously claimed.
//
// Uniqueness is per (tenant_id, name) as of 1.26.0. It was a global
// UNIQUE (name) on an already tenant-scoped table, which made cloning
// impossible -- the second tenant's copy collided with the first -- so these
// two were never provisioned and every tenant saw an empty dropdown.
export const campaignStatusesTable = marketingSchema.table('campaign_statuses', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  label:       text('label').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
}, (t) => ({
  uqCampaignStatusesTenantName: unique('uq_campaign_statuses_tenant_name').on(t.tenantId, t.name),
}));
