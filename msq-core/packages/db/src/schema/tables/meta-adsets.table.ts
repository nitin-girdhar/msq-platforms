import { uuid, text, bigint, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';

/**
 * Name caches for the two per-lead Meta names the rule engine matches on
 * (`adset_name`, `ad_name`), plus the ad set's promoted page (1.51.0).
 *
 * Same discovery-cache shape as `ext.meta_campaigns`: tenant-scoped, global
 * natural-id UNIQUE, no soft delete. Written by the campaign fetch and, for a
 * brand-new ad set or ad, by the lead path — one Graph call per NEW id.
 */
export const metaAdsetsTable = extSchema.table('meta_adsets', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:       uuid('tenant_id').notNull().references(() => tenantsTable.id),
  metaAdsetId:    bigint('meta_adset_id', { mode: 'bigint' }).notNull(),
  metaCampaignId: bigint('meta_campaign_id', { mode: 'bigint' }),
  name:           text('name'),
  promotedPageId: bigint('promoted_page_id', { mode: 'bigint' }),
  effectiveStatus: text('effective_status'),
  lastSyncedAt:   timestamp('last_synced_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqMetaAdsetsAdsetId: unique('uq_meta_adsets_adset_id').on(t.metaAdsetId),
}));

export const metaAdsTable = extSchema.table('meta_ads', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:       uuid('tenant_id').notNull().references(() => tenantsTable.id),
  metaAdId:       bigint('meta_ad_id', { mode: 'bigint' }).notNull(),
  metaAdsetId:    bigint('meta_adset_id', { mode: 'bigint' }),
  metaCampaignId: bigint('meta_campaign_id', { mode: 'bigint' }),
  name:           text('name'),
  effectiveStatus: text('effective_status'),
  lastSyncedAt:   timestamp('last_synced_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqMetaAdsAdId: unique('uq_meta_ads_ad_id').on(t.metaAdId),
}));
