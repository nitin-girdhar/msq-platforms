import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        // 0.4.0 ships ESM with extensionless relative imports, which plain
        // Node ESM cannot resolve (Next's bundler can). Let vite transform it.
        inline: ['@material/material-color-utilities'],
      },
    },
  },
});
