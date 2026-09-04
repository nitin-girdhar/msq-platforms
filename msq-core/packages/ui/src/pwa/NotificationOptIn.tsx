'use client';

import { useState } from 'react';
import Button from '../components/page/Button';
import { InstallPrompt } from './InstallPrompt';
import { usePushSubscription } from './usePushSubscription';

/**
 * In-context opt-in for follow-up push notifications. Mounted on the follow-ups
 * screen, where "tell me when one is due" is self-evident — not at first login,
 * where an unexplained permission prompt reads as noise and gets denied, after
 * which the browser will never let the app ask again.
 *
 * It surfaces the real subscription state rather than a toggle that lies:
 * - `granted`       → confirmation + a way to turn it back off.
 * - `default`       → the ask, leading with the benefit.
 * - `denied`        → an explanation that only device/browser settings can undo
 *                     it. After one Deny the API is powerless, so a button that
 *                     appears to do nothing would be the worst outcome.
 * - `not-installed` → the iOS Home Screen install instruction (`InstallPrompt`).
 * - `unsupported`   → renders nothing.
 */
const CARD = 'flex items-start gap-3 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 shadow-sm';

export function NotificationOptIn(): React.ReactNode {
  const { status, subscribe, unsubscribe } = usePushSubscription();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local-only: the browser gives no way to revoke `granted`, so once the user
  // turns notifications off we show the paused state until the next launch
  // rather than snapping straight back to "on".
  const [pausedLocally, setPausedLocally] = useState(false);

  if (status === 'unsupported') return null;
  if (status === 'not-installed') return <InstallPrompt />;

  async function run(action: () => Promise<void>, paused: boolean, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPausedLocally(paused);
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const enable = () => run(subscribe, false, 'Could not enable notifications.');
  const disable = () => run(unsubscribe, true, 'Could not turn notifications off.');

  if (status === 'denied') {
    return (
      <div className={CARD}>
        <div className="flex-1 text-sm text-[#334155]">
          <p className="font-semibold text-[#0F172A]">Notifications are blocked</p>
          <p className="mt-0.5 text-xs text-[#64748B]">
            Your browser is blocking follow-up alerts for this site. We can&apos;t re-ask —
            you&apos;ll need to allow notifications for this app in your device or browser
            settings, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'granted' && !pausedLocally) {
    return (
      <div className={CARD}>
        <div className="flex-1 text-sm text-[#334155]">
          <p className="font-semibold text-[#0F172A]">Follow-up notifications are on</p>
          <p className="mt-0.5 text-xs text-[#64748B]">
            You&apos;ll be told when a follow-up is due, even with the app closed.
          </p>
          {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
        </div>
        <Button variant="danger" size="sm" onClick={disable} disabled={busy}>
          {busy ? 'Working…' : 'Turn off'}
        </Button>
      </div>
    );
  }

  // `default`, or `granted` after the user paused it this session.
  return (
    <div className={CARD}>
      <div className="flex-1 text-sm text-[#334155]">
        <p className="font-semibold text-[#0F172A]">Get told when a follow-up is due</p>
        <p className="mt-0.5 text-xs text-[#64748B]">
          Turn on notifications to hear about due follow-ups even when the app is closed.
        </p>
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>
      <Button variant="primary" size="sm" onClick={enable} disabled={busy}>
        {busy ? 'Working…' : 'Turn on'}
      </Button>
    </div>
  );
}
