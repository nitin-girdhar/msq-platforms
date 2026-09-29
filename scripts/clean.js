#!/usr/bin/env node
// Two passes:
//  1. Workspace packages (discovered from pnpm-workspace.yaml) get their build
//     output removed — dist/ and .next/ are only deleted here, because those
//     names are too generic to delete blindly anywhere in the tree.
//  2. A recursive walk of the whole hub (skipping .git) removes caches whose
//     names are unambiguous: .turbo, *.tsbuildinfo, Python bytecode/tool
//     caches, and — in 'all' mode — every node_modules and Python venv.
//     This catches what pass 1 cannot see: product-root .turbo dirs
//     (msq-lms/.turbo), non-workspace node projects (msq-e2e-validation), and
//     Python scripts (msq-lms/meta-sync-scripts/__pycache__).
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
  const dirs = new Set();
  for (const g of readWorkspaceGlobs()) {
    for (const dir of expandGlob(g)) dirs.add(dir);
  }
  return [...dirs];
}

// Pass 1 — generic build-output names, workspace packages only.
const workspaceBuildDirs = ['dist', '.next'];

// Pass 2 — unambiguous cache names, anywhere in the tree.
const cacheDirs = new Set([
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
]);
const cacheFileSuffixes = ['.tsbuildinfo', '.pyc', '.pyo'];
// Full-reset only (need `make install` / `pip install -r` afterwards).
const depDirs = new Set(['node_modules', '.venv', 'venv']);

// Never descend into these (VCS metadata, or dependency trees we either just
// deleted or are deliberately keeping in 'build' mode).
const skipDirs = new Set(['.git', 'node_modules', '.venv', 'venv']);

let removed = 0;

function remove(abs) {
  fs.rmSync(abs, { recursive: true, force: true });
  console.log('removed', path.relative(root, abs));
  removed++;
}

for (const dir of findWorkspacePackageDirs()) {
  for (const name of workspaceBuildDirs) {
    const abs = path.join(root, dir, name);
    if (fs.existsSync(abs)) remove(abs);
  }
}

function walk(dirAbs) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      if (cacheDirs.has(e.name) || (mode === 'all' && depDirs.has(e.name))) {
        remove(abs);
      } else if (!skipDirs.has(e.name)) {
        walk(abs);
      }
    } else if (cacheFileSuffixes.some((s) => e.name.endsWith(s))) {
      remove(abs);
    }
  }
}

walk(root);

console.log(`\nDone. ${removed} item(s) removed.`);
if (mode === 'all') {
  console.log('Run: make install  (pnpm install; also `npm install` in msq-e2e-validation and');
  console.log('     `pip install -r requirements.txt` for any Python scripts you use)');
}
