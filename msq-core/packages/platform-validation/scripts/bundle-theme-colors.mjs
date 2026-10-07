// @material/material-color-utilities 0.4.0 is published as ESM whose internal imports have no file
// extension ('./dynamic_color'). Webpack resolves that, Node does not, so any server process that
// requires this package died at startup with ERR_MODULE_NOT_FOUND (identity-service, 2026-10-06).
// After tsc, inline the library into dist/theme-colors.js so Node never has to resolve it. The
// output stays CommonJS like the rest of dist. Same library version as @platform/ui-kit/theme, so
// both colour engines keep producing identical shades (see ui/src/theme/__tests__/color-overrides.test.ts).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const file = join(dist, 'theme-colors.js');

await build({
  entryPoints: [file],
  outfile: file,
  allowOverwrite: true,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'warning',
});
console.log('bundled @material/material-color-utilities into dist/theme-colors.js');
