import { uuid, text, boolean, numeric, timestamp, jsonb, unique, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entitySchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { orgTypesTable } from './org-types.table';
import { citiesTable } from './cities.table';
import { statesTable } from './states.table';
import { countriesTable } from './countries.table';

export const organizationsTable = entitySchema.table('organizations', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:        uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'restrict' }),
  name:            text('name').notNull(),
  legalEntityName: text('legal_entity_name'),
  brandName:       text('brand_name'),
  orgTypeId:       uuid('org_type_id').references(() => orgTypesTable.id),
  addressLine1:    text('address_line1'),
  addressLine2:    text('address_line2'),
  landmark:        text('landmark'),
  pincode:         text('pincode'),
  city:            text('city'),
  // geo.* is tenant-scoped, so these are COMPOSITE FKs on (tenant_id, x_id) —
  // declared below. An org can only point at a place its own tenant owns.
  cityId:          uuid('city_id'),
  stateId:         uuid('state_id'),
  countryId:       uuid('country_id'),
  timezone:        text('timezone').notNull().default('Asia/Kolkata'),
  // Geofence centre for attendance (additive, added in db_scripts/13).
  geoLat:          numeric('geo_lat', { precision: 9, scale: 6 }),
  geoLng:          numeric('geo_lng', { precision: 9, scale: 6 }),
  isActive:        boolean('is_active').notNull().default(true),
  isDeleted:       boolean('is_deleted').notNull().default(false),
  deletedAt:       timestamp('deleted_at', { withTimezone: true }),
  deletedBy:       uuid('deleted_by'),
  metadata:        jsonb('metadata').notNull().default({}),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqOrganizationsTenantName: unique('uq_organizations_tenant_name').on(t.tenantId, t.name),
  fkOrganizationsCity: foreignKey({
    name: 'fk_organizations_city',
    columns: [t.tenantId, t.cityId],
    foreignColumns: [citiesTable.tenantId, citiesTable.id],
  }).onDelete('restrict'),
  fkOrganizationsState: foreignKey({
    name: 'fk_organizations_state',
    columns: [t.tenantId, t.stateId],
    foreignColumns: [statesTable.tenantId, statesTable.id],
  }).onDelete('restrict'),
  fkOrganizationsCountry: foreignKey({
    name: 'fk_organizations_country',
    columns: [t.tenantId, t.countryId],
    foreignColumns: [countriesTable.tenantId, countriesTable.id],
  }).onDelete('restrict'),
}));
