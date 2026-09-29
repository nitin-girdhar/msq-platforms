import { uuid, text, bigint, integer, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';
import { metaTenantConfigTable } from './meta-tenant-config.table';
import { marketingLeadsTable } from './marketing-leads.table';
import { usersTable } from './users.table';

/**
 * Webhook leads that did NOT become an LMS lead (1.51.0): unmapped page,
 * missing contact, or a sync failure. A super admin maps
 * the page and presses Retry from the Meta Lead Inbox screen.
 *
 * `tenantId` / `orgId` are nullable — an unmapped page is exactly the case where
 * neither is known. Tenant-less rows match no RLS policy and are reached only on
 * the super_admin service path. `rawFieldData` is the lead's PII, held so Retry
 * does not depend on Meta still returning the lead.
 */
export const metaLeadInboxTable = extSchema.table('meta_lead_inbox', {
  id:             uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  metaLeadId:     bigint('meta_lead_id', { mode: 'bigint' }).notNull(),
  tenantId:       uuid('tenant_id').references(() => tenantsTable.id, { onDelete: 'cascade' }),
  orgId:          uuid('org_id').references(() => organizationsTable.id, { onDelete: 'set null' }),
  integrationId:  uuid('integration_id').references(() => metaTenantConfigTable.id, { onDelete: 'set null' }),
  pageId:         bigint('page_id', { mode: 'bigint' }),
  formId:         bigint('form_id', { mode: 'bigint' }),
  campaignId:     bigint('campaign_id', { mode: 'bigint' }),
  adsetId:        bigint('adset_id', { mode: 'bigint' }),
  adId:           bigint('ad_id', { mode: 'bigint' }),
  /** 'fb' | 'ig' | 'wa' */
  platform:       text('platform'),
  leadCreatedAt:  timestamp('lead_created_at', { withTimezone: true }),
  rawFieldData:   jsonb('raw_field_data'),
  /** 'unmapped' | 'missing_contact' | 'sync_failed' */
  reason:         text('reason').notNull(),
  errorText:      text('error_text'),
  /** 'open' | 'resolved' | 'ignored' */
  status:         text('status').notNull().default('open'),
  attempts:       integer('attempts').notNull().default(1),
  resolvedLeadId: uuid('resolved_lead_id').references(() => marketingLeadsTable.id, { onDelete: 'set null' }),
  resolvedBy:     uuid('resolved_by').references(() => usersTable.id, { onDelete: 'set null' }),
  resolvedAt:     timestamp('resolved_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqMetaLeadInboxMetaLeadId: unique('uq_meta_lead_inbox_meta_lead_id').on(t.metaLeadId),
}));
