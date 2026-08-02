import { uuid, text, boolean, unique, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geoSchema } from '../pg-schemas';
import { countriesTable } from './countries.table';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/08_rls.sql) — see countries.table.ts for the
// template-row convention. The FK to geo.countries is COMPOSITE on
// (tenant_id, country_id) so a tenant's state cannot hang off another tenant's
// country; RLS alone does not prevent that.
export const statesTable = geoSchema.table('states', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  countryId:   uuid('country_id').notNull(),
  name:        text('name').notNull(),
  code:        text('code'),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
}, (t) => ({
  uqStatesTenantId: unique('uq_states_tenant_id').on(t.tenantId, t.id),
  fkStatesCountry: foreignKey({
    name: 'fk_states_country',
    columns: [t.tenantId, t.countryId],
    foreignColumns: [countriesTable.tenantId, countriesTable.id],
  }).onDelete('restrict'),
  uixTemplateName: uniqueIndex('uix_geo_states_template_name').on(t.countryId, t.name).where(sql`tenant_id IS NULL`),
  uixTenantName:   uniqueIndex('uix_geo_states_tenant_name').on(t.tenantId, t.countryId, t.name).where(sql`tenant_id IS NOT NULL`),
}));
