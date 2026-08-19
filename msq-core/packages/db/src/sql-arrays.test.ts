import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sqlUuidArr, sqlTextArr } from './sql-arrays.js';

const dialect = new PgDialect();
const compile = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q);

// Regression guard for the bug these helpers exist to prevent.
//
// A bare JS array interpolated into a Drizzle `sql` template compiles to a
// parenthesised PARAMETER LIST, not a Postgres array: one element yields
// `ANY(($1)::uuid[])` — which Postgres rejects with `malformed array literal` —
// and two yields `ANY(($1, $2)::uuid[])`, a syntax error. It looks correct in
// TypeScript and fails only at runtime, so assert the compiled SQL directly.
describe('sqlUuidArr', () => {
  it('compiles an empty list to an empty typed array, not a bare ()', () => {
    const q = compile(sql`org_id = ANY(${sqlUuidArr([])})`);
    expect(q.sql).toBe("org_id = ANY('{}'::uuid[])");
    expect(q.params).toEqual([]);
  });

  it('compiles one element to ARRAY[$1::uuid], each value still parameterised', () => {
    const q = compile(sql`org_id = ANY(${sqlUuidArr(['a1'])})`);
    expect(q.sql).toBe('org_id = ANY(ARRAY[$1::uuid])');
    expect(q.params).toEqual(['a1']);
  });

  it('compiles two elements to a comma-separated ARRAY[...]', () => {
    const q = compile(sql`org_id = ANY(${sqlUuidArr(['a1', 'b2'])})`);
    expect(q.sql).toBe('org_id = ANY(ARRAY[$1::uuid, $2::uuid])');
    expect(q.params).toEqual(['a1', 'b2']);
  });

  it('never emits the broken bare-array form', () => {
    const broken = compile(sql`org_id = ANY(${['a1']}::uuid[])`);
    // Document the trap: this is what the old call sites compiled to.
    expect(broken.sql).toBe('org_id = ANY(($1)::uuid[])');
    expect(compile(sql`org_id = ANY(${sqlUuidArr(['a1'])})`).sql).not.toBe(broken.sql);
  });
});

describe('sqlTextArr', () => {
  it('compiles an empty list to an empty text array', () => {
    expect(compile(sql`platform = ANY(${sqlTextArr([])})`).sql).toBe("platform = ANY('{}'::text[])");
  });

  it('compiles elements to ARRAY[$n::text]', () => {
    const q = compile(sql`platform = ANY(${sqlTextArr(['meta', 'google'])})`);
    expect(q.sql).toBe('platform = ANY(ARRAY[$1::text, $2::text])');
    expect(q.params).toEqual(['meta', 'google']);
  });
});
