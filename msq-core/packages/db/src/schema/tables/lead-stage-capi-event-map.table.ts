import { uuid, integer, timestamp, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { leadStageTable } from './lead-stage.table';
import { metaCapiEventTypesTable } from './meta-capi-event-types.table';
import { tenantsTable } from './tenants.table';

// Tenant-scoped (RLS, db_scripts/08_rls.sql) as of 1.25.0, because
// lms.lead_stage is: each tenant owns its own stage catalog, so this holds one
// row per tenant per mapped stage. tenant_id IS NULL marks a platform template,
// cloned by entity.seed_tenant_lms_catalogs().
//
// The FK is COMPOSITE on (tenant_id, stage_id) — RLS scopes reads, but only the
// FK stops a row being written against another tenant's stage.
export const leadStageCapiEventMapTable = extSchema.table('lead_stage_capi_event_map', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:        uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  stageId:         uuid('stage_id').notNull().unique(),
  capiEventTypeId: integer('capi_event_type_id').notNull()
    .references(() => metaCapiEventTypesTable.id, { onDelete: 'restrict' }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  fkCapiEventMapStage: foreignKey({
    name: 'fk_capi_event_map_stage',
    columns: [t.tenantId, t.stageId],
    foreignColumns: [leadStageTable.tenantId, leadStageTable.id],
  }).onDelete('cascade'),
}));
