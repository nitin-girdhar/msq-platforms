import { uuid, text, bigint, boolean, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { scratchSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';
import { marketingLeadsTable } from './marketing-leads.table';
import { campaignTypesTable } from './campaign-types.table';
import { metaPullRunsTable } from './meta-pull-runs.table';

/**
 * One row per lead Meta returned for a pull run, classified against LMS.
 *
 * The raw-lead columns are shaped to map 1:1 onto `syncLeadToDatabase`'s
 * `RawMetaLead` parameter, because Apply calls that canonical write path rather
 * than writing leads itself — which is what makes campaign typing, pool routing
 * and dedup apply automatically, and what makes re-running Apply safe.
 *
 * `orgId` IS NULLABLE, unlike `ext.meta_page_form_org_map` where it is NOT
 * NULL. **That is deliberate and is not an inconsistency to fix:** a staged row
 * with NO org IS the `unmapped_form` verdict — a lead Meta returned for a form
 * nobody has mapped. It is recorded so the admin can see it and go fix the
 * mapping, and Apply skips it with that reason; it can never be applied.
 *
 * Disposable: cascades away when its run is cleared by the next pull.
 */
export const metaPullLeadsTable = scratchSchema.table('meta_pull_leads', {
  id:              uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  runId:           uuid('run_id').notNull().references(() => metaPullRunsTable.id, { onDelete: 'cascade' }),
  tenantId:        uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  /** Null IS the `unmapped_form` verdict. See the note above. */
  orgId:           uuid('org_id').references(() => organizationsTable.id, { onDelete: 'cascade' }),
  pageId:          bigint('page_id', { mode: 'bigint' }),
  formId:          bigint('form_id', { mode: 'bigint' }).notNull(),
  /** Staged because `isHiringForm` is derived from it and the review grid is unreadable without it. */
  formName:        text('form_name'),
  metaLeadId:      bigint('meta_lead_id', { mode: 'bigint' }).notNull(),
  campaignId:      bigint('campaign_id', { mode: 'bigint' }),
  adsetId:         bigint('adset_id', { mode: 'bigint' }),
  adId:            bigint('ad_id', { mode: 'bigint' }),
  /** 'fb' | 'ig' | 'wa' */
  platform:        text('platform'),
  leadCreatedAt:   timestamp('lead_created_at', { withTimezone: true }),
  rawFieldData:    jsonb('raw_field_data'),
  /**
   * 'already_synced' | 'test_lead' | 'unmapped_form' | 'missing_contact'
   * | 'phone_duplicate' | 'email_duplicate' | 'new'
   *
   * Ported verdict-for-verdict and IN ORDER from
   * meta-sync-scripts/common/reconcile.py::classify. The two duplicate verdicts
   * are IMPORTABLE on purpose: the canonical write path supersedes on phone and
   * returns the existing lead on email, and either way an `ext.meta_leads` row
   * is written — which is what stops the lead being re-fetched forever.
   */
  verdict:         text('verdict'),
  existingLeadId:  uuid('existing_lead_id').references(() => marketingLeadsTable.id, { onDelete: 'set null' }),
  reason:          text('reason'),
  /**
   * Recruitment-looking form name. In the Python this was a SKIP verdict,
   * because there was nowhere to route a job applicant. Since campaign types
   * (schema 1.49.0) there is, so it stopped being a verdict: the lead classifies
   * and imports normally, and the admin is pointed at
   * `ext.meta_page_form_org_map.default_campaign_type_id`.
   */
  isHiringForm:    boolean('is_hiring_form').notNull().default(false),
  /** What `marketing.fn_match_campaign_type` matched on the form name, if anything. */
  suggestedCampaignTypeId: uuid('suggested_campaign_type_id')
                     .references(() => campaignTypesTable.id, { onDelete: 'set null' }),
  /** 'pending' | 'applied' | 'skipped' | 'failed' */
  appliedStatus:   text('applied_status').notNull().default('pending'),
  appliedLeadId:   uuid('applied_lead_id').references(() => marketingLeadsTable.id, { onDelete: 'set null' }),
  appliedError:    text('applied_error'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Meta pages the same lead across cursor pages more often than its docs
  // admit, so the staging insert is ON CONFLICT DO NOTHING against this.
  uqMetaPullLeadsRunLead: unique('uq_meta_pull_leads_run_lead').on(t.runId, t.metaLeadId),
}));
