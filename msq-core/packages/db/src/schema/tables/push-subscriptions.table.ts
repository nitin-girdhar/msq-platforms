import { uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { notifySchema } from '../pg-schemas';
import { organizationsTable } from './organizations.table';
import { usersTable } from './users.table';

/**
 * Web Push subscriptions — one row per installed PWA + browser + device.
 *
 * Platform-wide, not LMS-owned: notifications-service is the first consumer,
 * hr-service and tasks-service are expected to follow.
 *
 * `endpoint` is the natural key and is UNIQUE, so the subscribe path must
 * upsert (`onConflictDoUpdate` on endpoint) — the client re-registers on every
 * launch and would otherwise accumulate a row per launch.
 *
 * Rows are hard-deleted (unsubscribe, and 404/410 pruning); there is
 * deliberately no is_deleted/soft-delete column set.
 *
 * RLS (08_rls.sql) constrains `user_id` as well as `org_id` for app_user: a
 * subscription is personal, not org-shared.
 */
export const pushSubscriptionsTable = notifySchema.table('push_subscriptions', {
  id:         uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  userId:     uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  orgId:      uuid('org_id').notNull().references(() => organizationsTable.id, { onDelete: 'cascade' }),
  // No FK, matching iam.token_blocklist — denormalized from the org at
  // subscribe time to back the tenant_admin RLS predicate.
  tenantId:   uuid('tenant_id').notNull(),
  endpoint:   text('endpoint').notNull(),   // push service URL; UNIQUE, see below
  p256dh:     text('p256dh').notNull(),     // PushSubscription.keys.p256dh
  auth:       text('auth').notNull(),       // PushSubscription.keys.auth
  userAgent:  text('user_agent'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (t) => ({
  endpointKey: uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint),
  userOrgIdx:  index('idx_push_subscriptions_user_org').on(t.userId, t.orgId),
}));
