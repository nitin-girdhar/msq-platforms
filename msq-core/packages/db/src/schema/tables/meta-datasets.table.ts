import { uuid, text, timestamp, unique, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { metaBusinessPortfoliosTable } from './meta-business-portfolios.table';
import { metaPlatformCredentialsTable } from './meta-platform-credentials.table';

/**
 * A dataset (pixel) conversion events are sent to (1.79.0). The composite FK (tenant_id, portfolio_id) means a
 * dataset can never be filed under a different tenant than the portfolio that owns it. Platform-level, RLS on
 * with no app-role policy (root_service only).
 */
export const metaDatasetsTable = extSchema.table('meta_datasets', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:       uuid('tenant_id').notNull(),
  portfolioId:    uuid('portfolio_id').notNull(),
  datasetId:      text('dataset_id').notNull(),
  name:           text('name'),
  /** NULL = the active CAPI_WRITE credential. */
  credentialId:   uuid('credential_id').references(() => metaPlatformCredentialsTable.id, { onDelete: 'set null' }),
  /** Set while testing: events show in Events Manager > Test events only. */
  testEventCode:  text('test_event_code'),
  /** 'PENDING' | 'ACTIVE' | 'NO_ACCESS' | 'DISABLED' */
  status:         text('status').notNull().default('PENDING'),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  lastError:      text('last_error'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqDatasetId: unique('uq_meta_datasets_dataset_id').on(t.datasetId),
  uqTenantRow: unique('uq_meta_datasets_tenant_id').on(t.tenantId, t.id),
  fkPortfolio: foreignKey({
    name: 'fk_meta_datasets_portfolio',
    columns: [t.tenantId, t.portfolioId],
    foreignColumns: [metaBusinessPortfoliosTable.tenantId, metaBusinessPortfoliosTable.id],
  }).onDelete('cascade'),
}));
