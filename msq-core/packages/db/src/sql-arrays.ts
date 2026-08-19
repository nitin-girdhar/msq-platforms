import { sql } from 'drizzle-orm';

// Postgres array parameters for raw `sql` templates.
//
// A bare JS array interpolated into a Drizzle `sql` template does NOT become a
// Postgres array. Drizzle expands it into a parenthesised parameter LIST —
// `sql`x = ANY(${['a']}::uuid[])`` compiles to `x = ANY(($1)::uuid[])`, which
// Postgres rejects with `malformed array literal`, and the multi-element form
// `ANY(($1, $2)::uuid[])` is a syntax error. Always build the array explicitly
// with these helpers.
//
// Both stay fully parameterised (one bind per element), so no caller input is
// ever concatenated into SQL.

/** `ARRAY[$1::uuid, $2::uuid, …]`, or an empty uuid[] when there is nothing to match. */
export function sqlUuidArr(arr: readonly string[]) {
  if (arr.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(arr.map((v) => sql`${v}::uuid`), sql`, `)}]`;
}

/** `ARRAY[$1::text, $2::text, …]`, or an empty text[] when there is nothing to match. */
export function sqlTextArr(arr: readonly string[]) {
  if (arr.length === 0) return sql`'{}'::text[]`;
  return sql`ARRAY[${sql.join(arr.map((v) => sql`${v}::text`), sql`, `)}]`;
}
