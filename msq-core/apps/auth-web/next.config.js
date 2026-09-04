// auth-web — the single sign-on shell. Renders login / change-password /
// select-branch / no-access and proxies its own /api/* to the shared gateway.
//
// NO `basePath`: auth-web owns the ROOT of the shared host
// (https://apps.fitclass.in/, http://app.localhost/ locally) and every other
// app hangs off a prefix beneath it — /lms /hrms /todo /admin /sa. Adding a
// basePath here would leave nothing serving `/`, which is also the service
// worker's scope and the manifest's start_url (docs/Architecture.md → Web push & PWA).
//
// Root paths are therefore RESERVED by this app. No product prefix may collide
// with a route auth-web serves, and auth-web must not later add a route named
// after a product prefix.
//
// Plain .js (not .ts): `next start` re-reads this file at runtime, which
// requires the `typescript` package to be present — but production images
// are deployed with `pnpm deploy --prod`, which excludes devDependencies.
/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@platform/ui-kit'],
  async rewrites() {
    const apiGateway = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiGateway}/:path*` }];
  },
};

module.exports = config;
