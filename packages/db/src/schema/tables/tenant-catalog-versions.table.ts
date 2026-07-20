import { uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entitySchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

// Per-tenant record of which catalog version was seeded / last reset (see
// db_scripts/23). Drives seeder idempotency: entity.seed_tenant_defaults skips
// any catalog already recorded here, so re-running provisioning never
// overwrites a tenant's customisations. Tenant-scoped (RLS): SELECT-only for
// subject roles; only root_service writes (via the seeder functions).
export const tenantCatalogVersionsTable = entitySchema.table('tenant_catalog_versions', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:   uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  catalogKey: text('catalog_key').notNull(),
  version:    integer('version').notNull(),
  seededAt:   timestamp('seeded_at', { withTimezone: true }).notNull().defaultNow(),
  resetAt:    timestamp('reset_at', { withTimezone: true }),
});
