import { DEFAULT_BRAND, getPublicBranding, platformName } from '@platform/ui-kit/server';
import { DEFAULT_THEME, buildScheme } from '@platform/ui-kit/theme';

// Served at /manifest.webmanifest from the root origin (auth-web owns the
// root — see docs/Architecture.md → Web push & PWA). scope: '/' covers every
// product path (/lms, /hrms, /todo, /admin, /sa) under the single-origin
// topology, so one install gets one push subscription for the whole platform.
//
// Per-tenant (schema 1.57.0): product layouts link `?b=<public_key>` — a
// manifest fetch carries no session cookie, so the tenant's rotatable public
// key travels in the URL. It selects display data only (name, icons, colours);
// an unknown, rotated or absent key serves the platform default.
//
// Icons come from the tenant's own uploads, one slot per size (nothing is
// resized here): icon_192, app_icon (512) and app_icon_maskable. A missing slot
// falls back to the platform's static icon for that size.
export async function GET(request: Request): Promise<Response> {
  const key = new URL(request.url).searchParams.get('b');
  const brand = await getPublicBranding(key);
  const name = brand.brandName ?? DEFAULT_BRAND.name;
  const a = brand.assets;

  // Colours follow the tenant's theme; the default (un-themed) tenant keeps the
  // platform's manifest colours, so nothing changes for it.
  const themed = brand.theme.seed_hex !== DEFAULT_THEME.seed_hex;
  const scheme = themed ? buildScheme(brand.theme.seed_hex, false) : {};
  const themeColor = scheme['--color-primary'] ?? DEFAULT_BRAND.manifestThemeColor;
  const backgroundColor = scheme['--color-background'] ?? DEFAULT_BRAND.manifestBackgroundColor;

  const manifest = {
    name: platformName(brand.brandName),
    short_name: name.slice(0, DEFAULT_BRAND.shortNameMax),
    start_url: '/',
    scope: '/',
    // Hard requirement for iOS Web Push: Safari only exposes
    // Notification.requestPermission() to a standalone (Home Screen) launch,
    // never to a browser tab. Without this, iPhone push does not work at all.
    display: 'standalone',
    background_color: backgroundColor,
    theme_color: themeColor,
    orientation: 'portrait-primary',
    // '/' is deliberate, not a placeholder: auth-web's root already resolves
    // the session and redirects via sessionDestination() in
    // src/lib/callback.ts, so a cold app launch lands each user on the
    // product they can actually use rather than a hardcoded landing page.
    icons: [
      { src: a.icon_192 ?? DEFAULT_BRAND.icons.icon192, sizes: '192x192', type: 'image/png' },
      { src: a.app_icon ?? DEFAULT_BRAND.icons.icon512, sizes: '512x512', type: 'image/png' },
      // A tenant that supplied no maskable icon gets none of its own: reusing the
      // plain app icon would be cropped by the OS mask, so the platform's
      // maskable (only when the tenant has no app icon either) is used instead.
      ...((a.app_icon_maskable ?? (a.app_icon ? null : DEFAULT_BRAND.icons.icon512Maskable))
        ? [{ src: (a.app_icon_maskable ?? DEFAULT_BRAND.icons.icon512Maskable) as string, sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
        : []),
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
