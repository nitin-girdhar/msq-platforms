import { uuid, text, boolean, unique, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geoSchema } from '../pg-schemas';
import { statesTable } from './states.table';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/08_rls.sql) — see countries.table.ts for the
// template-row convention and states.table.ts for the composite-FK rationale.
export const citiesTable = geoSchema.table('cities', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  stateId:     uuid('state_id').notNull(),
  name:        text('name').notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
}, (t) => ({
  uqCitiesTenantId: unique('uq_cities_tenant_id').on(t.tenantId, t.id),
  fkCitiesState: foreignKey({
    name: 'fk_cities_state',
    columns: [t.tenantId, t.stateId],
    foreignColumns: [statesTable.tenantId, statesTable.id],
  }).onDelete('restrict'),
  uixTemplateName: uniqueIndex('uix_geo_cities_template_name').on(t.stateId, t.name).where(sql`tenant_id IS NULL`),
  uixTenantName:   uniqueIndex('uix_geo_cities_tenant_name').on(t.tenantId, t.stateId, t.name).where(sql`tenant_id IS NOT NULL`),
}));
