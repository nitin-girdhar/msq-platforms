// Guard for tenant branding (docs/Architecture.md → Tenant branding):
//   - the platform's own default brand name is spelled in ONE place,
//     msq-core/packages/ui/src/branding/defaults.ts (DEFAULT_BRAND); no screen, layout,
//     email or manifest may hard-code "FitClass" / "Fitclass" — a tenant must see its own
//     name, and the default must come from DEFAULT_BRAND.
//   - default image paths (/fitclass-emblem.png, /fitclass-logo-white.webp) likewise live
//     only in DEFAULT_BRAND.
// Run: node scripts/check-brand-hardcoding.mjs          (exit 1 on any hit)
//      node scripts/check-brand-hardcoding.mjs --locale (also REPORTS ad-hoc date/number
//                                                         formatting; informational, never fails)
// Skipped on purpose: comments (they may cite history), tests, defaults.ts itself, and files
// that are static by design and cannot read a tenant: global-error.tsx (renders outside the
// layout) and public/sw.js (a static worker; the brand arrives in the push payload).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [
  'msq-core/apps', 'msq-core/packages/ui/src', 'msq-core/services',
  'msq-lms/apps', 'msq-lms/packages/lms-web', 'msq-lms/services',
  'msq-hrms/apps', 'msq-hrms/packages/hr-web', 'msq-hrms/services',
  'msq-todo/apps', 'msq-todo/packages/task-web', 'msq-todo/services',
];
const SKIP_DIR = new Set(['node_modules', '.next', 'dist', '.turbo', 'api-testing', 'public', '__tests__']);
const SKIP_FILE = /(global-error|\.test\.|\.d\.ts|branding[\\/]defaults\.ts$)/;
const BRAND_RULES = [
  [/fitclass/i, 'hard-coded default brand name or asset (use DEFAULT_BRAND)'],
];
// Informational only until every screen has moved to useLocale() / createFormatters().
const LOCALE_RULES = [
  [/\.toLocale(?:Date|Time)?String\(/, 'toLocale*String — use useLocale() / createFormatters()'],
  [/new Intl\.(?:DateTimeFormat|NumberFormat)\(/, 'Intl formatter — use useLocale() / createFormatters()'],
];
const withLocale = process.argv.includes('--locale');

const hits = [];
const info = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p); continue; }
    if (!/\.(tsx|ts)$/.test(e.name) || SKIP_FILE.test(p.replaceAll('\\', '/'))) continue;
    // The locale module itself is where Intl is allowed to live.
    const inLocaleModule = /ui[\\/]src[\\/]locale[\\/]/.test(p);
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may cite old values
      for (const [re, why] of BRAND_RULES) if (re.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}  ${why}`);
      if (withLocale && !inLocaleModule) {
        for (const [re, why] of LOCALE_RULES) if (re.test(line)) info.push(`${path.relative(root, p)}:${i + 1}  ${why}`);
      }
    });
  }
}
for (const r of ROOTS) if (fs.existsSync(path.join(root, r))) walk(path.join(root, r));

if (withLocale) console.log(`locale (informational): ${info.length} ad-hoc formatting call(s) still to move to @platform/ui-kit/locale`);
if (hits.length) {
  console.error(`${hits.length} brand hard-coding violation(s):\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('brand hard-coding: clean');
