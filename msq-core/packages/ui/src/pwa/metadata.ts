// Shared PWA metadata every product root layout spreads into its own
// `export const viewport` / `export const metadata`. See
// docs/Architecture.md → Web push & PWA and manifest.ts (auth-web) for the rest
// of the install story — this file only carries the per-page <meta>/<link> tags.

import type { Metadata, Viewport } from 'next';

// `viewport-fit=cover` lets content extend under the iOS notch/home-indicator
// safe areas; pairs with `env(safe-area-inset-*)` CSS in the shared shell.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// iOS ignores the web manifest's `display: 'standalone'` unless this legacy
// Apple meta tag is also present, so both are required for the Home Screen
// launch to open without Safari chrome.
export const appleWebApp: Metadata['appleWebApp'] = {
  capable: true,
  statusBarStyle: 'default',
  title: 'FitClass',
};

// `appleWebApp.capable` above does NOT emit `apple-mobile-web-app-capable` on
// Next 15 — it renders only the standardised `mobile-web-app-capable`, verified
// against the served HTML. Older iOS reads solely the Apple-prefixed name, so
// without this the Home Screen launch can fall back to a Safari-chrome tab,
// which is the one behaviour the whole single-origin topology exists to avoid.
// Emitting both is harmless on versions that read the standard name.
export const appleCapableMeta: Metadata['other'] = {
  'apple-mobile-web-app-capable': 'yes',
};

// iOS never reads the web manifest's `icons`, so the Home Screen icon comes
// solely from this link tag. The path is origin-absolute because auth-web owns
// the root and serves /icons/* for every product path (see manifest.ts).
// The file is flattened onto an opaque background at build time: Safari does
// not composite transparency and would render an alpha PNG as a black square.
// Declaring `icons` at all — even with only `apple` set — suppresses Next's
// app/icon.png file convention, so the tab favicon has to be listed here too
// or every app falls back to the browser default. Both paths are
// origin-absolute and Next does NOT basePath-prefix metadata icon hrefs
// (verified against lookup-admin's `/sa`), so one copy under the root origin
// serves every product path.
export const icons: Metadata['icons'] = {
  icon: '/icons/favicon.png',
  apple: '/icons/apple-touch-icon.png',
};
