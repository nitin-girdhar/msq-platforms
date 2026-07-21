#!/usr/bin/env node
/**
 * Generates per-service .env files from the root .env.
 *
 * Usage:  node scripts/setup-env.js
 *
 * Each service gets only the variables it actually needs (defined in its
 * .env.example).  Running this script is optional — during monorepo dev
 * `pnpm dev` loads the root .env directly via `tsx --env-file ../../.env`.
 *
 * Use per-service .env files when:
 *   - Debugging a single service in isolation (`pnpm dev:local`)
 *   - Building a standalone Docker image that needs baked-in defaults
 *   - Running in CI where each service is tested independently
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rootEnvPath = path.join(ROOT, '.env');

if (!fs.existsSync(rootEnvPath)) {
  console.error('Root .env not found. Copy .env.example → .env first.');
  process.exit(1);
}

function parseEnv(filePath) {
  const vars = {};
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return vars;
}

const rootVars = parseEnv(rootEnvPath);

function readDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

// Render one .env* from the target's own .env.example: it declares exactly the
// keys that target needs, and the root .env supplies the values. A key absent
// from the root keeps the example's value as its default.
function writeEnvFrom(exampleDir, outName, label, repoVars = {}) {
  const examplePath = path.join(exampleDir, '.env.example');
  if (!fs.existsSync(examplePath)) return 0;

  const needed = parseEnv(examplePath);
  const lines = ['# Auto-generated from root .env — do not commit'];
  for (const [key, fallback] of Object.entries(needed)) {
    // Precedence: the product repo's own .env, then the platform root .env,
    // then the target's example default. The repo layer matters for values that
    // are per-repo rather than platform-wide — above all DATABASE_URL, which
    // carries a PER-PRODUCT login (hr_svc / task_svc / lms_svc). Taking the
    // platform root's DATABASE_URL for every service would hand each one
    // lead_svc, a role with no privileges outside the LMS schemas, and its
    // queries would fail with "permission denied" rather than anything obvious.
    lines.push(`${key}=${repoVars[key] ?? rootVars[key] ?? fallback}`);
  }
  fs.writeFileSync(path.join(exampleDir, outName), lines.join('\n') + '\n', 'utf-8');
  console.log(`  ${label}/${outName}`);
  return 1;
}

let generated = 0;

// The platform root holds no apps/ or services/ of its own — each product repo
// (msq-core / msq-lms / msq-hrms / msq-todo / msq-deploy) carries its own pair,
// so both are one level deeper than this script originally assumed. Walking the
// repos keeps new products working without touching this file.
const repos = readDirs(ROOT).filter(d => d.startsWith('msq-'));

for (const repo of repos) {
  // The product repo's own .env — the file its dev scripts actually load
  // (`tsx --env-file ../../.env`), so it is the authority for that repo.
  const repoEnvPath = path.join(ROOT, repo, '.env');
  const repoVars = fs.existsSync(repoEnvPath) ? parseEnv(repoEnvPath) : {};

  for (const svc of readDirs(path.join(ROOT, repo, 'services'))) {
    // Services load .env; the dev scripts point tsx --env-file at the root .env,
    // so this is for isolated/CI/Docker runs.
    generated += writeEnvFrom(
      path.join(ROOT, repo, 'services', svc),
      '.env',
      `${repo}/services/${svc}`,
      repoVars,
    );
  }

  for (const app of readDirs(path.join(ROOT, repo, 'apps'))) {
    // Next.js only auto-loads .env* from its OWN app directory, never the
    // monorepo root, so a web app has no other way to see these values. Without
    // it NEXT_PUBLIC_AUTH_URL is undefined and the product middleware bounces
    // unauthenticated users to a same-origin /login that does not exist.
    generated += writeEnvFrom(
      path.join(ROOT, repo, 'apps', app),
      '.env.local',
      `${repo}/apps/${app}`,
      repoVars,
    );
  }
}

console.log(`\nGenerated ${generated} .env files from root .env`);
