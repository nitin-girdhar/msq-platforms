# `@platform/web-push`

Web Push delivery over `notify.push_subscriptions` (see `db_scripts/02_tables_core.sql`,
`07_grants.sql`, `08_rls.sql`). Background: [docs/Architecture.md → Web push & PWA](../../../docs/Architecture.md#web-push--pwa).

## VAPID keys

Generate **once**, per environment:

```bash
npx web-push generate-vapid-keys
```

Set three vars wherever the consuming service runs:

| Var | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the public key; also served to clients via `GET /notifications/push/public-key` |
| `VAPID_PRIVATE_KEY` | the private key — a long-lived secret, treated like a signing key |
| `VAPID_SUBJECT` | `mailto:ops@…` or an `https://` URL; push services reject anything else |

> **Rotating these keys invalidates every existing subscription on every
> device.** Every user's phone goes quiet until they re-open the installed app
> and it silently re-subscribes (step 8). Do not regenerate casually, do not
> regenerate "to be safe", and never let a deploy script generate them.

`assertWebPushEnv()` is called from the consuming service's `start()` so a
missing var fails at boot with a readable message, rather than lazily on the
first send — which is inside a poller tick nobody is watching.

## API

```ts
saveSubscription({ userId, orgId, tenantId, subscription, userAgent? }): Promise<void>
deleteSubscription(endpoint, scope?: { userId, orgId }): Promise<number>
deleteSubscriptionsForUser(userId, orgId?): Promise<number>
sendToUser(userId, orgId, { title, body, url, leadId? }): Promise<{ sent, pruned }>
vapidPublicKey(): string
assertWebPushEnv(): void
setWebPushLogger(logger): void
```

## Rules baked in

- **Identity is server-derived.** Callers pass ids resolved from
  `parseAuthContext` (gateway headers) or from a row being processed — never
  from a request body.
- **`saveSubscription` upserts on `endpoint`.** The client re-registers on every
  launch; a device that changes hands re-points to the new user instead of
  keeping a second row.
- **Route handlers must pass `scope` to `deleteSubscription`.** The unscoped
  form exists only for the 404/410 pruning path inside `sendToUser`.
- **404/410 prune immediately.** A dead endpoint otherwise fails forever on
  every tick and the table grows without bound. The count comes back as `pruned`.
- **Every other failure is logged and swallowed.** `sendToUser` never throws: a
  failing push must not break the caller's loop or the SSE delivery beside it.
- **Payload is `{ title, body, url, leadId }` only** — under the ~4KB cap, and
  no tenant data is written to a handset. `title`/`body` are truncated
  defensively rather than throwing at send time.
- **`org_id` scopes every read.** A rep mapped to several branches must not
  receive a branch-B notification.

## RLS

This package runs on `serviceDb()` (`root_service`, BYPASSRLS) because a send
fans out to a user's devices from a poller tick with no app session whose GUCs
RLS could read — the reasoning `07_grants.sql` and `08_rls.sql` already record
for this table. Because RLS is not the boundary here, **every statement carries
its own explicit `user_id` / `org_id` predicate**. Those predicates are the
boundary; do not remove one.
