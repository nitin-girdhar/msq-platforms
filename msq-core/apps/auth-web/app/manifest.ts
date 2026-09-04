import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest from the root origin (auth-web owns the
// root — see docs/Architecture.md → Web push & PWA). scope: '/' covers every
// product path (/lms, /hrms, /todo, /admin, /sa) under the single-origin
// topology, so one install gets one push subscription for the whole platform.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FitClass Platform',
    short_name: 'FitClass',
    start_url: '/',
    scope: '/',
    // Hard requirement for iOS Web Push: Safari only exposes
    // Notification.requestPermission() to a standalone (Home Screen) launch,
    // never to a browser tab. Without this, iPhone push does not work at all.
    display: 'standalone',
    background_color: '#F8FAFC',
    theme_color: '#0F172A',
    orientation: 'portrait-primary',
    // '/' is deliberate, not a placeholder: auth-web's root already resolves
    // the session and redirects via sessionDestination() in
    // src/lib/callback.ts, so a cold app launch lands each user on the
    // product they can actually use rather than a hardcoded landing page.
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
