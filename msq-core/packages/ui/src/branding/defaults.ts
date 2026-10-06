// The ONE place the platform's own default brand is named. A tenant that has not
// uploaded an image / set a name falls back to these; nothing else in the apps or
// packages may spell the default name, icon path or manifest colour (a repo
// grep gate enforces it — see docs/Architecture.md → Tenant branding).
//
// Image defaults are the static files every app already bundles under `public/`
// (and auth-web's `/icons/*`). They are origin-absolute because auth-web owns the
// root origin; callers that render inside a product basePath must wrap the
// bundled ones with `withBasePath()`.

export const DEFAULT_BRAND = {
  /** Brand name shown when the tenant has not set one. */
  name: 'FitClass',
  /** Installed-app name suffix: "<brand> Platform". */
  platformSuffix: 'Platform',
  /** Bundled square emblem (also the sidebar mark default). */
  emblem: '/fitclass-emblem.png',
  /** Bundled white lockup, used on dark panels. */
  logoWhite: '/fitclass-logo-white.webp',
  /** Static icon set served from the root origin. */
  icons: {
    favicon: '/icons/favicon.png',
    appleTouch: '/icons/apple-touch-icon.png',
    icon192: '/icons/icon-192.png',
    icon512: '/icons/icon-512.png',
    icon512Maskable: '/icons/icon-512-maskable.png',
  },
  /** Web-app manifest colours for the default (un-themed) tenant. */
  manifestThemeColor: '#0F172A',
  manifestBackgroundColor: '#F8FAFC',
  /** Short Home Screen label limit (manifest short_name). */
  shortNameMax: 12,
} as const;

/** `<brand> Platform` — the installed app's full name. */
export function platformName(brandName: string | null | undefined): string {
  return `${brandName?.trim() || DEFAULT_BRAND.name} ${DEFAULT_BRAND.platformSuffix}`;
}
