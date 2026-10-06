import { uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { extSchema } from '../pg-schemas';
import { tenantsTable } from './tenants.table';
import { usersTable } from './users.table';

/**
 * One summary row per lead-pull run (1.70.0). scratch.meta_pull_runs keeps only the
 * tenant's latest run, so earlier pulls left no trace. This keeps who/when/what was
 * asked/the tallies/how it ended — and none of the lead details.
 */
export const metaPullRunHistoryTable = extSchema.table('meta_pull_run_history', {
  runId:       uuid('run_id').primaryKey(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenantsTable.id, { onDelete: 'cascade' }),
  triggerKind: text('trigger_kind').notNull().default('manual'),
  status:      text('status').notNull(),
  filters:     jsonb('filters').notNull().default({}),
  counts:      jsonb('counts').notNull().default({}),
  createdBy:   uuid('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
  startedAt:   timestamp('started_at', { withTimezone: true }),
  finishedAt:  timestamp('finished_at', { withTimezone: true }),
  appliedAt:   timestamp('applied_at', { withTimezone: true }),
  discardedAt: timestamp('discarded_at', { withTimezone: true }),
  errorText:   text('error_text'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
