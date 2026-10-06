// Guard for the Stitch theme rules (skills/react-typescript §6):
//   - no raw palette classes (slate-*, red-600, bg-white …) or hex colours in UI code
//   - no px font sizes (text-[Npx], font-size: Npx) — text size is user-selectable
// Run: node scripts/check-theme-tokens.mjs   (exit 1 on any hit)
// Intentionally unthemed and skipped: global-error.tsx (renders outside the layout),
// payslip print, emails, manifests, theme.css (it DEFINES the palette), tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [
  'msq-core/apps', 'msq-core/packages/ui/src', 'msq-core/packages/team-web',
  'msq-lms/apps', 'msq-lms/packages/lms-web', 'msq-hrms/apps', 'msq-hrms/packages/hr-web',
  'msq-todo/apps', 'msq-todo/packages/task-web',
];
const SKIP_DIR = new Set(['node_modules', '.next', 'dist', '.turbo', 'theme', 'styles', 'api-testing']);
const SKIP_FILE = /(global-error|printPayslip|\.test\.|\.d\.ts|manifest)/;
const RULES = [
  [/\[#[0-9a-fA-F]{3,8}\]/, 'hex colour utility'],
  [/\b(?:slate|gray|zinc|neutral|stone|red|green|amber|emerald|rose|sky|blue|yellow|orange|indigo|purple|violet)-[0-9]{2,3}\b/, 'palette class'],
  [/\b(?:bg|text|border)-white\b/, 'bg/text/border-white'],
  [/text-\[[0-9.]+px\]/, 'px font size'],
  [/font-size:\s*[0-9.]+px/, 'px font size (css)'],
  [/fontSize:\s*['"]?[0-9.]+(?:px)?['"]?[,\s}]/, 'numeric fontSize'],
];

const hits = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p); continue; }
    if (!/\.(tsx|ts|css)$/.test(e.name) || SKIP_FILE.test(e.name)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may cite old values
      for (const [re, why] of RULES) if (re.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}  ${why}`);
    });
  }
}
for (const r of ROOTS) if (fs.existsSync(path.join(root, r))) walk(path.join(root, r));

if (hits.length) {
  console.error(`${hits.length} theme-token violation(s):\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('theme tokens: clean');
