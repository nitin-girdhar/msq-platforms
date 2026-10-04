import { getPublicBranding } from '@platform/ui-kit/server';

// Served at /manifest.webmanifest from the root origin (auth-web owns the
// root — see docs/Architecture.md → Web push & PWA). scope: '/' covers every
// product path (/lms, /hrms, /todo, /admin, /sa) under the single-origin
// topology, so one install gets one push subscription for the whole platform.
//
// Per-tenant (schema 1.57.0): product layouts link `?b=<public_key>` — a
// manifest fetch carries no session cookie, so the tenant's rotatable public
// key travels in the URL. It selects display data only (name + app icon); an
// unknown, rotated or absent key serves the platform default.
export async function GET(request: Request): Promise<Response> {
  const key = new URL(request.url).searchParams.get('b');
  const brand = await getPublicBranding(key);
  const name = brand.brandName ?? 'FitClass';
  const icon = brand.assets.app_icon;
  const manifest = {
    name: brand.brandName ? `${brand.brandName} Platform` : 'FitClass Platform',
    short_name: name.slice(0, 12),
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
    icons: icon
      ? [
          // One square PNG ≥512 (validated on upload); the browser scales it.
          { src: icon, sizes: '512x512', type: 'image/png' },
          { src: icon, sizes: '192x192', type: 'image/png' },
          { src: icon, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      : [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
