'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { push as pushApi } from '../api/resources';

/**
 * Web Push subscription lifecycle for the platform PWA.
 *
 * `status` distinguishes the four states a UI actually has to render
 * differently, plus `unsupported`:
 *
 * - `unsupported`     — no `serviceWorker` / `PushManager` (desktop Firefox in
 *                       some builds, old browsers). Nothing to offer.
 * - `not-installed`   — iOS Safari in an ordinary tab. On iPhone push does not
 *                       exist until the app is added to the Home Screen and
 *                       opened from that icon, so this MUST be distinct from
 *                       `default`: the user needs the install instruction, not a
 *                       button that calls `requestPermission()` and is silently
 *                       ignored by the OS.
 * - `default` / `granted` / `denied` — the `Notification.permission` value.
 *
 * `subscribe()` is the only path that calls `Notification.requestPermission()`,
 * and it must be invoked from a real user gesture (a click). iOS ignores a
 * non-gesture permission request outright, and Chrome penalises origins that
 * prompt on load. The hook never prompts on mount.
 *
 * On mount the hook reconciles silently: if permission is already `granted` it
 * re-POSTs the live `PushSubscription` (or creates one when none exists) so the
 * server row survives the common iOS case — deleting and re-adding the Home
 * Screen icon destroys the subscription with no event anywhere.
 */
export type PushStatus = 'unsupported' | 'not-installed' | 'default' | 'granted' | 'denied';

export interface UsePushSubscriptionReturn {
  status: PushStatus;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `navigator.standalone` is Safari-only and not in lib.dom.d.ts.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function hasPushApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function detectStatus(): PushStatus {
  if (typeof window === 'undefined') return 'default';
  // iOS-in-a-tab is checked before support: Safari there exposes neither
  // PushManager nor Notification, but the user's next step is "install", not
  // "your browser can't do this".
  if (isIos() && !isStandalone()) return 'not-installed';
  if (!hasPushApi()) return 'unsupported';
  return Notification.permission as PushStatus;
}

// VAPID public keys are delivered base64url; `pushManager.subscribe` wants the
// raw bytes as an ArrayBuffer.
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

async function createSubscription(reg: ServiceWorkerRegistration): Promise<void> {
  const { data } = await pushApi.publicKey();
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToArrayBuffer(data.public_key),
  });
  await pushApi.subscribe(subscription.toJSON());
}

export function usePushSubscription(): UsePushSubscriptionReturn {
  const [status, setStatus] = useState<PushStatus>('default');
  // Set once the user turns notifications off in this session, so the mount
  // reconciler does not immediately re-create the subscription it just deleted.
  const suppressReconcile = useRef(false);

  useEffect(() => {
    setStatus(detectStatus());

    let cancelled = false;
    (async () => {
      if (!hasPushApi() || Notification.permission !== 'granted') return;
      try {
        const reg = await navigator.serviceWorker.ready;
        if (cancelled || suppressReconcile.current) return;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled || suppressReconcile.current) return;
        if (existing) {
          // Keep the server row fresh (endpoint rotation, a re-installed device).
          await pushApi.subscribe(existing.toJSON());
        } else {
          // Permission is already granted — re-subscribe with no prompt, no UI.
          await createSubscription(reg);
        }
      } catch (err) {
        // Reconcile is best-effort; the user can still subscribe from the
        // button. Logged rather than swallowed outright: a bare `catch {}` here
        // is what let a completely broken subscribe endpoint look healthy on
        // every browser that had already granted permission, so the failure was
        // only ever reported from the one handset where someone pressed the
        // button.
        console.debug('[push] subscription reconcile failed', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (isIos() && !isStandalone()) {
      setStatus('not-installed');
      return;
    }
    if (!hasPushApi()) {
      setStatus('unsupported');
      return;
    }

    // Must run inside the click that called this — never deferred.
    const permission = await Notification.requestPermission();
    setStatus(permission as PushStatus);
    if (permission !== 'granted') return;

    suppressReconcile.current = false;
    const reg = await navigator.serviceWorker.ready;
    await createSubscription(reg);
  }, []);

  const unsubscribe = useCallback(async () => {
    suppressReconcile.current = true;
    try {
      if (!hasPushApi()) return;
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) return;
      try {
        await pushApi.unsubscribe(subscription.endpoint);
      } catch {
        // Still drop the local subscription even if the server call fails.
      }
      await subscription.unsubscribe();
    } finally {
      setStatus(detectStatus());
    }
  }, []);

  return { status, subscribe, unsubscribe };
}
