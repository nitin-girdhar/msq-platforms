import { uuid, boolean, timestamp, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { metaDatasetsTable } from './meta-datasets.table';

/**
 * FALLBACK only (1.79.0): the branch's dataset, used when a lead's ad account is unknown or unlinked. The two
 * composite FKs mean neither the branch nor the dataset can belong to a different tenant than `tenantId`.
 * Platform-level, RLS on with no app-role policy (root_service only).
 */
export const metaOrgDatasetMapTable = extSchema.table('meta_org_dataset_map', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:  uuid('tenant_id').notNull(),
  orgId:     uuid('org_id').notNull(),
  datasetId: uuid('dataset_id').notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  fkOrg: foreignKey({
    name: 'fk_meta_org_dataset_map_org',
    columns: [t.tenantId, t.orgId],
    foreignColumns: [organizationsTable.tenantId, organizationsTable.id],
  }).onDelete('cascade'),
  fkDataset: foreignKey({
    name: 'fk_meta_org_dataset_map_dataset',
    columns: [t.tenantId, t.datasetId],
    foreignColumns: [metaDatasetsTable.tenantId, metaDatasetsTable.id],
  }).onDelete('cascade'),
}));
