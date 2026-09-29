import { uuid, text, boolean, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { marketingSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { campaignTypesTable } from './campaign-types.table';

/**
 * The ORDERED rule list that turns Meta names into a campaign type (1.51.0).
 * Replaces `campaign_types.match_keywords` as the matcher's input.
 *
 * FIRST MATCH WINS in `ruleOrder` (lower first). A rule matches when `pattern`
 * appears on WORD BOUNDARIES, case-insensitive, in the name `matchField` picks:
 * the campaign's, the lead form's, the ad set's or the ad's. The matcher is
 * SQL — `marketing.fn_match_campaign_type_rules(tenant, campaign, form, adset, ad)`
 * — so every intake path agrees on what a rule means.
 *
 * A rule pointing at an inactive or deleted type is skipped, not an error.
 * `trg_campaign_type_rules_tenant_match` refuses a rule whose type belongs to
 * another tenant. Soft-deleted via `trg_campaign_type_rules_soft_delete`.
 */
export const campaignTypeRulesTable = marketingSchema.table('campaign_type_rules', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:       uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  ruleOrder:      integer('rule_order').notNull(),
  /** 'campaign_name' | 'form_name' | 'adset_name' | 'ad_name' */
  matchField:     text('match_field').notNull(),
  pattern:        text('pattern').notNull(),
  campaignTypeId: uuid('campaign_type_id').notNull().references(() => campaignTypesTable.id, { onDelete: 'restrict' }),
  isActive:       boolean('is_active').notNull().default(true),
  isDeleted:      boolean('is_deleted').notNull().default(false),
  deletedAt:      timestamp('deleted_at', { withTimezone: true }),
  deletedBy:      uuid('deleted_by'),
  createdBy:      uuid('created_by'),
  metadata:       jsonb('metadata').notNull().default({}),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
});
