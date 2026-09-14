import { uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { scratchSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { usersTable } from './users.table';

/**
 * A Meta lead-pull run. **The row IS the queue.**
 *
 * There is no job/queue infrastructure in this repo, so `POST
 * /meta/lead-pull/runs` inserts `queued` and returns immediately, and a poller
 * in meta-conversion-api claims work with `FOR UPDATE SKIP LOCKED`. Compose
 * runs one instance today; SKIP LOCKED is what keeps a second replica from
 * double-running a pull, which the poller's in-process boolean guard cannot do.
 *
 * `heartbeatAt` (written per page completed) plus a reaper that fails
 * stale-heartbeat runs is not optional bookkeeping: `POST /runs` refuses with
 * 409 while a run is queued/running/applying, so a deploy mid-pull would
 * otherwise strand the run in `running` forever and that tenant could never
 * start another one.
 *
 * Disposable — `POST /runs` deletes the tenant's previous run before starting a
 * new one, and the cascade takes the staged leads with it.
 */
export const metaPullRunsTable = scratchSchema.table('meta_pull_runs', {
  id:          uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  createdBy:   uuid('created_by').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  /** 'queued' | 'running' | 'completed' | 'failed' | 'applying' | 'applied' */
  status:      text('status').notNull().default('queued'),
  /**
   * The request as submitted (org_ids, page_ids, campaign_ids, since, until),
   * kept verbatim so the summary can say what was actually asked for —
   * including that the campaign filter was applied POST-FETCH and therefore
   * made the pull no cheaper.
   */
  filters:     jsonb('filters').notNull().default({}),
  /** Per-verdict tallies plus pages/forms walked, page-token errors, truncation. */
  counts:      jsonb('counts').notNull().default({}),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  startedAt:   timestamp('started_at', { withTimezone: true }),
  finishedAt:  timestamp('finished_at', { withTimezone: true }),
  appliedAt:   timestamp('applied_at', { withTimezone: true }),
  appliedBy:   uuid('applied_by').references(() => usersTable.id, { onDelete: 'set null' }),
  errorText:   text('error_text'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
