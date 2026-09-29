'use client';

import { useEffect, useState } from 'react';
import Button from '../components/page/Button';

const DISMISSED_KEY = 'fc-install-prompt-dismissed';

// Chrome/Android fires this before showing its native install UI; capturing
// it lets us defer that UI behind our own button instead of a browser-timed
// popup. Not in lib.dom.d.ts — Safari and Firefox never fire it.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
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

/**
 * Install nudge for the platform PWA. Android/Chrome gets a real "Install"
 * button; iOS Safari has no install API at all, so it gets a dismissible
 * "Add to Home Screen" instruction instead.
 *
 * This is not cosmetic on iOS — it is the ONLY path to push notifications
 * there (Safari refuses Notification.requestPermission() from an ordinary
 * browser tab). The copy leads with what installing unlocks, not just
 * "install our app". See docs/PWA_User_Guide.md for user-facing details.
 */
export function InstallPrompt(): React.ReactNode {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === '1');
    } catch {
      // Private browsing / storage blocked — treat as not dismissed.
      setDismissed(false);
    }

    if (isIos() && !isStandalone()) {
      setIosHint(true);
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Ignore — worst case the hint reappears next session.
    }
  }

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  if (dismissed || (!deferredPrompt && !iosHint)) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 shadow-sm">
      <div className="flex-1 text-sm text-[#334155]">
        <p className="font-semibold text-[#0F172A]">Get notified when a follow-up is due</p>
        {iosHint ? (
          <p className="mt-0.5 text-xs text-[#64748B]">
            Install FitClass to your Home Screen for push alerts even when the app is
            closed: tap <span className="font-medium">Share</span>, then{' '}
            <span className="font-medium">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-[#64748B]">
            Install FitClass for push alerts even when the app is closed.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!iosHint && (
          <Button variant="primary" size="sm" onClick={handleInstallClick}>
            Install
          </Button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
