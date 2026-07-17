/**
 * Converts a single Drizzle result row's top-level keys from camelCase to
 * snake_case for API responses. Does not recurse into nested values (e.g.
 * jsonb metadata) — only renames the row's own keys.
 */
function toSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toApiRow<T extends Record<string, unknown> | null | undefined>(
  row: T,
): T extends null ? null : T extends undefined ? undefined : Record<string, unknown> {
  if (row === null || row === undefined) return row as never;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[toSnakeKey(key)] = value;
  }
  return out as never;
}

/** Same as toApiRow but for an array of rows. */
export function toApiRows<T extends Record<string, unknown>>(rows: T[]): Record<string, unknown>[] {
  return rows.map((row) => toApiRow(row));
}
