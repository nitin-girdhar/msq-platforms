import type { NextConfig } from 'next';

const config: NextConfig = {
  // @crm/ui ships TypeScript source (no build step) — Next.js transpiles it
  // as part of the app build, same as first-party source. Chosen over a
  // plain-tsc ESM build (like @crm/types) because the package is React/JSX +
  // DOM-hook code, which is what apps/web already knows how to compile.
  transpilePackages: ['@crm/ui'],
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

export default config;
