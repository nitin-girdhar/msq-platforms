// admin-web — the org_admin/tenant_admin console, served at /admin under the
// shared host. NOT lookup-admin: that is the super-admin tooling at /sa.
//
// Plain .js (not .ts): `next start` re-reads this file at runtime, which
// requires the `typescript` package to be present — but production images
// are deployed with `pnpm deploy --prod`, which excludes devDependencies.
/** @type {import('next').NextConfig} */
const config = {
  // Single-origin topology — see the note in msq-lms/apps/lms-web/next.config.js.
  // Compiled into the image; must match ADMIN_WEB_URL
  // (`http://app.localhost/admin`) and the `handle /admin/*` block in
  // infra/Caddyfile, which reverse-proxies admin-web on :3004.
  basePath: '/admin',
  // @hr/web ships no build output (types/main point at src) — same
  // transpile-from-source pattern hr-web itself uses for its own copy.
  transpilePackages: ['@platform/ui-kit', '@hr/web', '@platform/team-web'],
  async rewrites() {
    const apiGateway = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';
    return [
      {
        // Auto-prefixed to /admin/api/:path*; the absolute destination is left
        // un-prefixed. See the fuller note in lms-web/next.config.js.
        source: '/api/:path*',
        destination: `${apiGateway}/:path*`,
      },
    ];
  },
};

module.exports = config;
