// Data access for notify.push_subscriptions.
//
// RLS BYPASS, DELIBERATE — this module runs on `serviceDb()` (root_service,
// BYPASSRLS), which is what 07_grants.sql and 08_rls.sql already document for
// this table: `sendToUser` fans out to every device of a target user from a
// poller tick, where there is no app session whose GUCs RLS could read.
//
// Because RLS is not the boundary here, EVERY statement below carries its own
// explicit user_id/org_id predicate. Those predicates are the boundary. Do not
// remove one on the grounds that "the caller already checked" — the caller is
// a loop over rows, not a session.

import { serviceDb } from '@platform/db';

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SaveSubscriptionInput {
  userId: string;
  orgId: string;
  tenantId: string;
  subscription: PushSubscriptionKeys;
  userAgent?: string | undefined;
}

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Upsert on `endpoint`, the table's natural key.
 *
 * The client re-registers on every app launch (so an INSERT-only path would
 * accumulate a row per launch). Re-pointing user/org/tenant on conflict also
 * handles a shared handset changing hands: the device moves to the new user
 * instead of holding two rows, one of which would keep pushing the previous
 * user's leads to it.
 */
export async function saveSubscription(input: SaveSubscriptionInput): Promise<void> {
  const db = serviceDb();
  await db`
    INSERT INTO notify.push_subscriptions
      (user_id, org_id, tenant_id, endpoint, p256dh, auth, user_agent, last_used_at)
    VALUES (
      ${input.userId}::uuid,
      ${input.orgId}::uuid,
      ${input.tenantId}::uuid,
      ${input.subscription.endpoint},
      ${input.subscription.keys.p256dh},
      ${input.subscription.keys.auth},
      ${input.userAgent ?? null},
      NOW()
    )
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id      = EXCLUDED.user_id,
      org_id       = EXCLUDED.org_id,
      tenant_id    = EXCLUDED.tenant_id,
      p256dh       = EXCLUDED.p256dh,
      auth         = EXCLUDED.auth,
      user_agent   = EXCLUDED.user_agent,
      last_used_at = NOW()
  `;
}

/**
 * Delete one registration by endpoint.
 *
 * `scope` is optional only so the 404/410 pruning path inside `sendToUser` can
 * drop a dead endpoint it has already resolved. **Every route handler must pass
 * it**: an endpoint is an opaque string, but without the user_id/org_id
 * predicate a caller who obtained someone else's endpoint could silence their
 * notifications — exactly the cross-user mutation `.claude/CLAUDE.md` forbids,
 * and the reason 08_rls.sql constrains user_id here and not org_id alone.
 *
 * Returns the number of rows removed, so an unscoped-delete attempt on a
 * foreign endpoint is observable as 0 rather than looking like success.
 */
export async function deleteSubscription(
  endpoint: string,
  scope?: { userId: string; orgId: string },
): Promise<number> {
  const db = serviceDb();
  const rows = scope
    ? await db`
        DELETE FROM notify.push_subscriptions
        WHERE endpoint = ${endpoint}
          AND user_id  = ${scope.userId}::uuid
          AND org_id   = ${scope.orgId}::uuid
        RETURNING id
      `
    : await db`
        DELETE FROM notify.push_subscriptions
        WHERE endpoint = ${endpoint}
        RETURNING id
      `;
  return rows.length;
}

/**
 * Drop every registration for a user, optionally narrowed to one org.
 * Used on logout-everywhere and on permission revoke.
 */
export async function deleteSubscriptionsForUser(userId: string, orgId?: string): Promise<number> {
  const db = serviceDb();
  const rows = orgId
    ? await db`
        DELETE FROM notify.push_subscriptions
        WHERE user_id = ${userId}::uuid AND org_id = ${orgId}::uuid
        RETURNING id
      `
    : await db`
        DELETE FROM notify.push_subscriptions
        WHERE user_id = ${userId}::uuid
        RETURNING id
      `;
  return rows.length;
}

/**
 * Every live registration for a user IN ONE ORG.
 *
 * org_id is not optional here. A rep mapped to several branches must not get a
 * branch-B notification on a branch-A device registration — the same rule
 * `connectionManager.sendToUser` already enforces for SSE.
 */
export async function findSubscriptions(userId: string, orgId: string): Promise<StoredSubscription[]> {
  const db = serviceDb();
  return (await db`
    SELECT id, endpoint, p256dh, auth
    FROM notify.push_subscriptions
    WHERE user_id = ${userId}::uuid
      AND org_id  = ${orgId}::uuid
  `) as unknown as StoredSubscription[];
}

/** Stamped after a successful send: how anyone later answers "is this device still alive". */
export async function touchLastUsed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = serviceDb();
  await db`
    UPDATE notify.push_subscriptions
    SET last_used_at = NOW()
    WHERE id IN ${db(ids)}
  `;
}
