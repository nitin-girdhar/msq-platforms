import { uuid, text, timestamp, primaryKey, unique } from 'drizzle-orm/pg-core';
import { extSchema } from '../pg-schemas';
import { metaDatasetsTable } from './meta-datasets.table';

/**
 * The routing key (1.79.0): an ad account feeds exactly ONE dataset (UNIQUE ad_account_id), and a lead's ad
 * account comes from its campaign. Platform-level, RLS on with no app-role policy (root_service only).
 */
export const metaDatasetAdAccountsTable = extSchema.table('meta_dataset_ad_accounts', {
  datasetId:   uuid('dataset_id').notNull().references(() => metaDatasetsTable.id, { onDelete: 'cascade' }),
  /** `act_<digits>` (FK to ext.meta_ad_accounts.ad_account_id) */
  adAccountId: text('ad_account_id').notNull(),
  verifiedAt:  timestamp('verified_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk:        primaryKey({ columns: [t.datasetId, t.adAccountId] }),
  uqAccount: unique('uq_meta_dataset_ad_accounts_account').on(t.adAccountId),
}));
