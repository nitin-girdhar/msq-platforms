import { uuid, text, bigint, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { usersTable } from './users.table';
import { campaignTypesTable } from './campaign-types.table';

/**
 * Discovery cache of Meta ad campaigns, and the SOURCE OF TRUTH for
 * campaign → campaign type.
 *
 * Shaped on `ext.meta_forms`: tenant-scoped, no `orgId`, the natural Meta id
 * carrying the UNIQUE. The mapping lives here rather than on
 * `marketing.ad_campaigns` because that table's `orgId` is NOT NULL — a CRM
 * campaign row is per BRANCH, while a Meta campaign is not branch-scoped (only
 * its leads are) and a proactive fetch from an ad account has no branch at all.
 * One row here means an admin confirms a campaign's type ONCE, not once per
 * branch.
 *
 * `uq_meta_campaigns_campaign_id` is GLOBAL, not per-tenant, on purpose: Meta
 * campaign ids are globally unique and one row must serve every branch.
 *
 * `mappingStatus`:
 *  - `suggested` — a keyword matched (`matchedKeyword` says which); needs
 *    confirming.
 *  - `unmapped`  — nothing matched; needs a manual pick.
 *  - `confirmed` — done. **Never overwrite a confirmed row from a fetch or a
 *    sync.** An inferred type is provisional; an admin's decision is not. Every
 *    writer must exclude `mappingStatus = 'confirmed'` explicitly.
 *
 * `adAccountId` is null when the row was discovered from an inbound lead rather
 * than fetched from an ad account; `firstSeenSource` records which.
 */
export const metaCampaignsTable = extSchema.table('meta_campaigns', {
  id:               uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:         uuid('tenant_id').notNull().references(() => tenantsTable.id),
  /** `act_<digits>`; null when the row came from a lead. */
  adAccountId:      text('ad_account_id'),
  metaCampaignId:   bigint('meta_campaign_id', { mode: 'bigint' }).notNull(),
  name:             text('name'),
  objective:        text('objective'),
  effectiveStatus:  text('effective_status'),
  metaCreatedTime:  timestamp('meta_created_time', { withTimezone: true }),
  campaignTypeId:   uuid('campaign_type_id').references(() => campaignTypesTable.id, { onDelete: 'restrict' }),
  /** 'unmapped' | 'suggested' | 'confirmed' */
  mappingStatus:    text('mapping_status').notNull().default('unmapped'),
  matchedKeyword:   text('matched_keyword'),
  confirmedBy:      uuid('confirmed_by').references(() => usersTable.id, { onDelete: 'set null' }),
  confirmedAt:      timestamp('confirmed_at', { withTimezone: true }),
  /** 'fetch' | 'lead' */
  firstSeenSource:  text('first_seen_source'),
  lastSyncedAt:     timestamp('last_synced_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqMetaCampaignsCampaignId: unique('uq_meta_campaigns_campaign_id').on(t.metaCampaignId),
}));
