import type { Metadata } from 'next';
import Image from 'next/image';
import { DEFAULT_BRAND } from '@platform/ui-kit/branding';
import AuthCard, { WifiOffIcon } from '@/components/auth/AuthCard';

export const metadata: Metadata = {
  title: `Offline · ${DEFAULT_BRAND.name}`,
  description: 'You are offline',
};

// The service worker's navigation fallback (public/sw.js). It is precached at
// install and served whenever a navigation cannot reach the network, so that a
// phone that drops signal shows this instead of the browser's error page —
// which, in a standalone Home Screen launch, looks like the app is broken.
//
// STATICALLY RENDERED AND SESSION-FREE, deliberately. No getServerSession, no
// props, no tenant or user data of any kind: this HTML is written to device
// storage by the worker and survives logout, so anything on it would outlive
// the session it came from (.claude/CLAUDE.md — no data leakage across tenant).
// Do not add a "your pending follow-ups" style block here. The only action is a
// plain same-URL link (works without JS) — no "work offline" / cached-data list:
// nothing is available offline, so the page must not promise it.
export default function OfflinePage() {
  return (
    <AuthCard
      icon={WifiOffIcon}
      title="You are offline"
      subtitle={`${DEFAULT_BRAND.name} needs a connection to load your data. Check your network and try again — nothing you have already saved is lost.`}
      topSlot={
        <div className="rounded-2xl bg-inverse-surface px-6 py-4">
          {/* Emblem, not the full lockup: the square white lockup (emblem + wordmark
              + tagline) collapses to an illegible smudge when squeezed to h-9 — see
              auth-web/app/login/page.tsx. */}
          <Image
            src={DEFAULT_BRAND.emblem}
            alt={DEFAULT_BRAND.name}
            width={160}
            height={160}
            priority
            className="h-9 w-auto object-contain"
          />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* A plain same-URL link, not a JS button: this page is served from the
            service worker's cache, where its hydration chunks may be missing, so a
            client onClick could be inert exactly when it is needed. An empty href
            re-requests the current URL (a navigation → network, or this fallback). */}
        <a
          href=""
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-label-md font-semibold text-on-primary shadow-card transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          Try reconnecting
        </a>
        <p className="text-center text-label-md text-on-surface-variant">
          Follow-up reminders will still reach you once you are back online.
        </p>
      </div>
    </AuthCard>
  );
}
