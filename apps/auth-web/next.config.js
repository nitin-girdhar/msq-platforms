// auth.app.com — the single sign-on shell. Renders login / change-password /
// select-branch and proxies its own /api/* to the shared gateway (so the
// browser-set session cookie is scoped to this origin's parent domain and
// shared with every product subdomain). No product feature packages here.
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
