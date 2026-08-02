import { uuid, text, varchar, boolean, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geoSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Tenant-scoped geography (RLS, db_scripts/08_rls.sql). tenant_id IS NULL marks
// a platform template row seeded by reference_data/01_geo.sql — RLS hides those
// from every application role, and entity.seed_tenant_geo() clones them into a
// tenant at provisioning time.
//
// Name/iso uniqueness is a PAIR of partial indexes per rule (06_indexes.sql):
// NULLs are distinct in a unique index, so one UNIQUE (tenant_id, name) would
// let the templates duplicate freely.
//
// uqCountriesTenantId exists so geo.states can take a composite
// (tenant_id, country_id) FK — a tenant's state must not hang off another
// tenant's country.
export const countriesTable = geoSchema.table('countries', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  isoCode:     varchar('iso_code', { length: 2 }).notNull(),
  description: text('description'),
  isActive:    boolean('is_active').notNull().default(true),
}, (t) => ({
  uqCountriesTenantId: unique('uq_countries_tenant_id').on(t.tenantId, t.id),
  uixTemplateName: uniqueIndex('uix_geo_countries_template_name').on(t.name).where(sql`tenant_id IS NULL`),
  uixTemplateIso:  uniqueIndex('uix_geo_countries_template_iso').on(t.isoCode).where(sql`tenant_id IS NULL`),
  uixTenantName:   uniqueIndex('uix_geo_countries_tenant_name').on(t.tenantId, t.name).where(sql`tenant_id IS NOT NULL`),
  uixTenantIso:    uniqueIndex('uix_geo_countries_tenant_iso').on(t.tenantId, t.isoCode).where(sql`tenant_id IS NOT NULL`),
}));
