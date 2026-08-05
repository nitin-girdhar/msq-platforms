// Plain .js (not .ts): `next start` re-reads this file at runtime, which
// requires the `typescript` package to be present — but production images
// are deployed with `pnpm deploy --prod`, which excludes devDependencies.
/** @type {import('next').NextConfig} */
const config = {
  // @hr/web ships no build output (types/main point at src) — same
  // transpile-from-source pattern hr-web itself uses for its own copy.
  transpilePackages: ['@platform/ui-kit', '@hr/web'],
  async rewrites() {
    const apiGateway = process.env['API_GATEWAY_INTERNAL_URL'] ?? 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiGateway}/:path*`,
      },
    ];
  },
};

module.exports = config;
