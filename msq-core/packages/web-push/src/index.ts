// @platform/web-push — Web Push over notify.push_subscriptions.
//
// Platform-level, not LMS-owned: notifications-service (follow-up due) is the
// first consumer, hr-service (leave approved/rejected) and tasks-service (task
// assigned) are expected next.
//
// ── The identity rule ──────────────────────────────────────────────────────
// Every function here takes ids the CALLER already resolved server-side. A
// route handler MUST source `userId` / `orgId` / `tenantId` from
// `parseAuthContext(request, reply)` — the gateway-injected, HMAC-verified
// headers — and NEVER from the request body, even when the client helpfully
// sends one. See
// `msq-lms/services/notifications-service/src/lib/auth-context.ts`.
//
// A subscription is personal, not org-shared: it is the address of somebody's
// locked phone. Reads and writes are scoped by user_id AND org_id throughout,
// so a rep mapped to several branches never receives a branch-B notification on
// a branch-A registration.
//
// Setup: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT must be set —
// call `assertWebPushEnv()` from the service's startup. See README.md.

export { assertWebPushEnv, vapidPublicKey } from './config.js';
export { setWebPushLogger } from './logger.js';
export type { WebPushLogger } from './logger.js';
export {
  saveSubscription,
  deleteSubscription,
  deleteSubscriptionsForUser,
} from './repository.js';
export type {
  SaveSubscriptionInput,
  PushSubscriptionKeys,
  StoredSubscription,
} from './repository.js';
export { sendToUser } from './sender.js';
export type { PushPayload, SendResult } from './sender.js';
