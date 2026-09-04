// lookup-admin — super-admin platform tooling, served at /sa under the shared
// host. NOT admin-web: that is the org/tenant console at /admin.
//
// Plain .js (not .ts): `next start` re-reads this file at runtime, which
// requires the `typescript` package to be present — but production images
// are deployed with `pnpm deploy --prod`, which excludes devDependencies.
/** @type {import('next').NextConfig} */
const config = {
  // Single-origin topology — see the note in msq-lms/apps/lms-web/next.config.js.
  // Compiled into the image; must match ADMIN_URL (`http://app.localhost/sa`)
  // and the `handle /sa/*` block in infra/Caddyfile, which reverse-proxies
  // lookup-admin on :3005.
  basePath: '/sa',
  transpilePackages: ['@platform/ui-kit'],
  async rewrites() {
    const apiGateway = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';
    return [
      {
        // Auto-prefixed to /sa/api/:path*; the absolute destination is left
        // un-prefixed. See the fuller note in lms-web/next.config.js.
        source: '/api/:path*',
        destination: `${apiGateway}/:path*`,
      },
    ];
  },
};

module.exports = config;
