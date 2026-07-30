// ── The entry-point boundary ─────────────────────────────────────────────────
// @platform/ui-kit imports this package's `.` entry and is transpiled into Next
// CLIENT bundles. So `.` must never reach drizzle, `postgres`, or a node builtin.
//
// This is enforced by a static import scan rather than by a bundler check,
// because the failure is silent: adding `import { sql } from 'drizzle-orm'` to a
// spec/ file compiles, tests pass, and the regression only shows up as a broken
// client build — or, worse, as dataset SQL fragments shipped to the browser.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** Modules that must never be reachable from the browser-safe entry. */
const SERVER_ONLY = [/^drizzle-orm/, /^postgres$/, /^node:/, /^pg$/, /^@platform\/db/];

function sources(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === '__tests__' ? [] : sources(full);
      }
      return full.endsWith('.ts') ? [full] : [];
    })
    .sort();
}

/** Bare module specifiers imported (or re-exported) by a file. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (spec !== undefined) specs.push(spec);
  }
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1];
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

/** Transitively resolve relative imports from an entry, collecting bare specs. */
function reachable(entry: string): { files: string[]; externals: string[] } {
  const seen = new Set<string>();
  const externals = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) {
        externals.add(spec);
        continue;
      }
      // Source uses .js extensions (NodeNext); the file on disk is .ts.
      const asTs = join(file, '..', spec.replace(/\.js$/, '.ts'));
      queue.push(asTs);
    }
  }
  return {
    files: [...seen].map((f) => relative(SRC, f)).sort(),
    externals: [...externals].sort(),
  };
}

describe('the browser-safe entry stays browser-safe', () => {
  it('reaches no server-only module from src/index.ts', () => {
    const { externals } = reachable(join(SRC, 'index.ts'));
    const leaked = externals.filter((e) => SERVER_ONLY.some((p) => p.test(e)));
    expect(leaked).toEqual([]);
  });

  it('reaches only zod', () => {
    // Pinned deliberately. A new external dependency on the client path is a
    // decision about client bundle size, so it should require editing this test.
    expect(reachable(join(SRC, 'index.ts')).externals).toEqual(['zod']);
  });

  it('reaches no file under sql/', () => {
    const { files } = reachable(join(SRC, 'index.ts'));
    expect(files.filter((f) => f.startsWith('sql'))).toEqual([]);
  });

  it('has no spec/ file importing a server-only module', () => {
    const offenders = sources(join(SRC, 'spec'))
      .filter((f) => importsOf(f).some((s) => SERVER_ONLY.some((p) => p.test(s))))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe('the server-only entry is the only path to drizzle', () => {
  it('reaches drizzle-orm from src/sql/index.ts', () => {
    // The complement of the assertions above: if this ever stops being true the
    // boundary tests would pass vacuously.
    expect(reachable(join(SRC, 'sql', 'index.ts')).externals).toContain('drizzle-orm');
  });

  it('does not depend on @platform/db — the executor is injected', () => {
    // Taking a SqlExecutor rather than importing the pool is what keeps `postgres`
    // out of every consumer, and lets the caller own the withRoleTx contract.
    expect(reachable(join(SRC, 'sql', 'index.ts')).externals).not.toContain('@platform/db');
  });
});
