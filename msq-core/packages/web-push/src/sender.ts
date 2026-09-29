import webpush, { WebPushError } from 'web-push';
import { ensureVapidConfigured } from './config.js';
import { log } from './logger.js';
import { deleteSubscription, findSubscriptions, touchLastUsed } from './repository.js';

/**
 * The whole payload. Kept to IDs and short strings on purpose:
 *
 *  - Push payloads have a ~4KB ceiling after encryption, and an oversized one
 *    throws at send time rather than degrading.
 *  - The payload is written to the device by the push service. Lead detail is
 *    tenant data and must not land on a handset — the client fetches it after
 *    the user opens the notification. See docs/Architecture.md → Web push & PWA.
 */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  leadId?: string | undefined;
}

export interface SendResult {
  sent: number;
  pruned: number;
}

// Defensive ceiling on the free-text field, well inside the ~4KB encrypted cap.
// Truncating here beats letting the push service reject the whole notification.
const MAX_BODY_CHARS = 400;
const MAX_TITLE_CHARS = 120;

function serializePayload(payload: PushPayload): string {
  return JSON.stringify({
    title: payload.title.slice(0, MAX_TITLE_CHARS),
    body: payload.body.slice(0, MAX_BODY_CHARS),
    url: payload.url,
    ...(payload.leadId ? { leadId: payload.leadId } : {}),
  });
}

/**
 * Push `payload` to every device this user has registered IN THIS ORG.
 *
 * `userId` and `orgId` are ids the CALLER resolved server-side — from
 * `parseAuthContext` (gateway-injected headers) on a route, or from the row
 * being processed in a poller. Never from a request body. See the barrel
 * comment in `index.ts`.
 *
 * Never throws. A push failure must not break the caller's loop or the SSE
 * delivery sitting next to it: notification delivery is best-effort, and the
 * work it points at is still visible in the app.
 */
export async function sendToUser(
  userId: string,
  orgId: string,
  payload: PushPayload,
): Promise<SendResult> {
  let sent = 0;
  let pruned = 0;

  try {
    ensureVapidConfigured();
  } catch (err) {
    log().error({ err }, 'web push not configured; skipping send');
    return { sent, pruned };
  }

  let subscriptions;
  try {
    subscriptions = await findSubscriptions(userId, orgId);
  } catch (err) {
    log().error({ err, userId, orgId }, 'failed to load push subscriptions');
    return { sent, pruned };
  }

  if (subscriptions.length === 0) return { sent, pruned };

  const body = serializePayload(payload);
  const delivered: string[] = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      delivered.push(sub.id);
      sent += 1;
    } catch (err) {
      // 404/410 mean the registration is gone for good — app deleted, Home
      // Screen icon removed, permission revoked. Left in place, a dead endpoint
      // fails forever on every single poller tick and the table only grows.
      const statusCode = err instanceof WebPushError ? err.statusCode : undefined;
      if (statusCode === 404 || statusCode === 410) {
        try {
          pruned += await deleteSubscription(sub.endpoint);
        } catch (pruneErr) {
          log().error({ err: pruneErr, userId, orgId }, 'failed to prune dead push subscription');
        }
        continue;
      }
      // Anything else (network blip, push-service 5xx) is transient: log and
      // move on. Swallowed on purpose — see the doc comment above.
      log().warn({ err, statusCode, userId, orgId }, 'push send failed');
    }
  }

  try {
    await touchLastUsed(delivered);
  } catch (err) {
    log().warn({ err }, 'failed to stamp last_used_at on push subscriptions');
  }

  return { sent, pruned };
}
