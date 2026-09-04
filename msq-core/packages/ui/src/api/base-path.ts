// This app's Next `basePath`, and the one safe way to prepend it.
//
// WHY THIS EXISTS
//
// Under the single-origin topology every product app is compiled with a
// `basePath` (/lms, /hrms, /todo, /admin, /sa) and auth-web owns the root.
// Next applies that prefix automatically to `<Link>`, router navigation,
// `/_next/*` assets and `rewrites()` sources — but NOT to `fetch()`, and NOT to
// a `next/image` `src`. A root-relative `fetch('/api/leads')` from a page at
// `/hrms/attendance` is sent to `https://<host>/api/leads`, which under one
// host is auth-web's root, not this app's proxy route.
//
// That failure is quiet rather than loud: auth-web has an identical
// `/api/:path*` rewrite, so the call still reaches the gateway and the screen
// still renders. What is lost is that every product's API traffic would funnel
// through auth-web, making it a bottleneck and a single point of failure for
// all six apps, and skipping the calling app's own middleware `/api/` gate.
//
// HOW THE VALUE IS RESOLVED
//
// `process.env.__NEXT_ROUTER_BASEPATH` is substituted with a string literal by
// Next's DefinePlugin, from `config.basePath`, into the client, server AND edge
// bundles alike (next@15.5.20, dist/build/define-env.js). Because the shared
// packages are compiled by each app's own webpack via `transpilePackages`, the
// SAME source resolves to a different literal per app — which is the property
// a hardcoded prefix could not have: `@hr/web` is built into hr-web at /hrms
// and into admin-web at /admin, and each copy must call its own host app.
//
// It is a Next-internal name, so `NEXT_PUBLIC_BASE_PATH` is honored as an
// explicit override/fallback, and an unset value degrades to '' — exactly the
// pre-basePath behavior, which is what keeps tests (no DefinePlugin) and any
// un-prefixed app working unchanged.

/**
 * The compiled `basePath` for the app this code was bundled into: '/hrms',
 * '/lms', … or '' for auth-web and for any non-Next consumer (tests, Node).
 * Never has a trailing slash.
 */
export function appBasePath(): string {
  const value =
    process.env['NEXT_PUBLIC_BASE_PATH'] ?? process.env['__NEXT_ROUTER_BASEPATH'] ?? '';
  return value.replace(/\/$/, '');
}

/**
 * Prepend this app's `basePath` to a root-relative path, for the places Next
 * does not do it for us — `fetch()` targets, `next/image` `src` values, and raw
 * `<a href>`/`location` navigation. Pass an absolute URL or a non-root-relative
 * value and it is returned untouched, so this is safe to apply blindly.
 *
 * `next/image` is the non-obvious one: Next prefixes the optimizer ENDPOINT
 * (`/lms/_next/image`) but passes `url=` through verbatim, then resolves it
 * against the server root — so an unprefixed `src` 400s with "The requested
 * resource isn't a valid image". See AppNavbar's logo.
 */
export function withBasePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${appBasePath()}${path}`;
}
