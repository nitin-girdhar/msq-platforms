import { uuid, text, bigint, integer, smallint, boolean, numeric, char, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { organizationsTable } from './organizations.table';
import { marketingLeadsTable } from './marketing-leads.table';
import { metaCapiEventTypesTable } from './meta-capi-event-types.table';

/**
 * The transactional outbox for Meta conversion events (1.79.0). One row = one event for one lead in one
 * dataset, written IN the stage-change transaction (ext.fn_enqueue_capi_events) and delivered by the
 * meta-conversion-api worker with retry. `eventTime` is when the STAGE changed; `expiresAt` is eventTime + 7
 * days (Meta rejects older). Skips are rows too (status SKIPPED_*) so every lead that never reached Meta has a
 * reason. Tenant + org scoped by RLS.
 */
export const metaCapiOutboxTable = extSchema.table('meta_capi_outbox', {
  id:                uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:          uuid('tenant_id').notNull().references(() => tenantsTable.id),
  orgId:             uuid('org_id').notNull().references(() => organizationsTable.id),
  /** Reporting only -- never routing. */
  departmentId:      uuid('department_id'),
  marketingLeadId:   uuid('marketing_lead_id').notNull().references(() => marketingLeadsTable.id),
  /** The leadgen id sent as user_data.lead_id. */
  metaLeadId:        bigint('meta_lead_id', { mode: 'bigint' }).notNull(),
  /** NULL on a SKIPPED_* row (no dataset resolved). */
  datasetId:         uuid('dataset_id'),
  stageId:           uuid('stage_id'),
  eventTypeId:       integer('event_type_id').notNull().references(() => metaCapiEventTypesTable.id),
  funnelRank:        smallint('funnel_rank'),
  eventName:         text('event_name').notNull(),
  eventId:           text('event_id').notNull(),
  eventTime:         timestamp('event_time', { withTimezone: true }).notNull(),
  eventValue:        numeric('event_value', { precision: 14, scale: 2 }),
  currency:          char('currency', { length: 3 }),
  isNegative:        boolean('is_negative').notNull().default(false),
  /** PENDING | SENDING | SENT | FAILED | DEAD | EXPIRED | SKIPPED_NO_DATASET | SKIPPED_TENANT_MISMATCH | SKIPPED_NO_MAPPING | SKIPPED_NOT_META | SKIPPED_AMBIGUOUS_DATASET */
  status:            text('status').notNull().default('PENDING'),
  attempts:          integer('attempts').notNull().default(0),
  nextRetryAt:       timestamp('next_retry_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt:         timestamp('expires_at', { withTimezone: true }).notNull(),
  lastError:         text('last_error'),
  fbTraceId:         text('fb_trace_id'),
  requestPayload:    jsonb('request_payload'),
  responsePayload:   jsonb('response_payload'),
  /** 'auto_stage_change' | 'manual' | 'backfill' */
  triggeredBy:       text('triggered_by').notNull().default('auto_stage_change'),
  triggeredByUserId: uuid('triggered_by_user_id'),
  sentAt:            timestamp('sent_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
