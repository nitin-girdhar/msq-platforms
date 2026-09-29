import type { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Offline · FitClass',
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
// Do not add a "your pending follow-ups" style block here.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F8FAFC] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <div className="rounded-2xl bg-[#0b1f3a] px-6 py-4">
            {/* Emblem, not the full lockup: the square fitclass-logo-white.webp
                (emblem + FITCLASS wordmark + tagline) collapses to an illegible
                smudge when squeezed to h-9 — see auth-web/app/login/page.tsx. */}
            <Image
              src="/fitclass-emblem.png"
              alt="FitClass"
              width={160}
              height={160}
              priority
              className="h-9 w-auto object-contain"
            />
          </div>
        </div>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">You are offline</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
            FitClass needs a connection to load your data. Check your network and try
            again — nothing you have already saved is lost.
          </p>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-400">
          Follow-up reminders will still reach you once you are back online.
        </p>
      </div>
    </div>
  );
}
