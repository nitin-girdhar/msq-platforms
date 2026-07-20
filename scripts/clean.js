#!/usr/bin/env node
// Discovers workspace packages dynamically from pnpm-workspace.yaml instead of
// a hardcoded path list (the old version listed packages/services that no
// longer exist — apps/web, packages/permissions, services/auth-service, etc.
// — and silently skipped everything real: packages/db, services/identity-service,
// the msq-lms/msq-hrms/msq-todo subfolders, ...).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mode = process.argv[2]; // 'build' or 'all'

// Parse the simple `packages:\n  - 'glob'` shape used by this repo's
// pnpm-workspace.yaml — no YAML dependency needed for this one pattern.
function readWorkspaceGlobs() {
  const raw = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*-\s*'([^']+)'/);
    if (m) globs.push(m[1]);
  }
  return globs;
}

// Expand a single-star glob like 'packages/*' or 'msq-lms/packages/*' against
// the filesystem (this repo never uses '**', only one trailing '*' segment).
function expandGlob(glob) {
  if (!glob.endsWith('/*')) return [glob]; // no wildcard, use as-is
  const parent = glob.slice(0, -2);
  const parentAbs = path.join(root, parent);
  if (!fs.existsSync(parentAbs)) return [];
  return fs
    .readdirSync(parentAbs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(parent, d.name));
}

function findWorkspacePackageDirs() {
  const globs = readWorkspaceGlobs();
  const dirs = new Set(['.']); // repo root itself (root node_modules/.turbo)
  for (const g of globs) {
    for (const dir of expandGlob(g)) dirs.add(dir);
  }
  return [...dirs];
}

const buildArtifactNames = ['dist', '.next', '.turbo'];
const nodeModulesName = 'node_modules';

function removeIfExists(abs, label) {
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
    console.log('removed', path.relative(root, abs) || label);
    return 1;
  }
  return 0;
}

let removed = 0;

for (const dir of findWorkspacePackageDirs()) {
  const dirAbs = path.join(root, dir);
  if (!fs.existsSync(dirAbs)) continue;

  for (const name of buildArtifactNames) {
    removed += removeIfExists(path.join(dirAbs, name));
  }
  // *.tsbuildinfo — usually 0 or 1 per package, glob manually.
  for (const f of fs.readdirSync(dirAbs)) {
    if (f.endsWith('.tsbuildinfo')) {
      removed += removeIfExists(path.join(dirAbs, f));
    }
  }
  if (mode === 'all') {
    removed += removeIfExists(path.join(dirAbs, nodeModulesName));
  }
}

console.log(`\nDone. ${removed} item(s) removed.`);
if (mode === 'all') {
  console.log('Run: pnpm install  (then pnpm -r build / pnpm turbo build for packages)');
}
