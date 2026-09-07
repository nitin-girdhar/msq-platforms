// Shared AG Grid configuration — the single source of truth for how every grid
// in the platform filters, so a column filter behaves identically on the Team
// roster, the lookup tables and every LMS grid.
//
// Rules for anyone adding a grid:
//   * Spread/assign `GRID_DEFAULT_COL_DEF` into the grid's `defaultColDef`.
//     Do NOT re-declare the literal — that is how the six existing grids drifted
//     into six copies with no filter configuration at all.
//   * Keep the per-column `filter` flag where it is. `GRID_DEFAULT_COL_DEF`
//     deliberately does not set `filter`: columns that opt out with
//     `filter: false` (the pinned action columns, FollowUpGrid's "Due In") must
//     stay off, and number/date columns must keep resolving to their own filter
//     type instead of being forced to text.
//   * A column with a `cellRenderer` that shows a label (a status/source badge)
//     must have a `valueGetter` returning that same label — the filter matches
//     the column value, so filtering on the raw DB value makes the grid look
//     broken when you type what is on screen.
//
// No `ag-grid-community` import here on purpose: `@platform/ui-kit` is consumed
// by apps that have no grid (auth-web, hr-web, todo-web), and this module is
// reached through the `./grid` subpath so nothing else pays for it. The shapes
// below are structurally compatible with `ColDef` / `TextFilterParams`;
// consumers annotate their own `defaultColDef` as `ColDef`.

/**
 * Case-, accent- and whitespace-insensitive normalisation, applied by AG Grid's
 * text filter to BOTH the cell value and the text typed into the filter box.
 * "Renée", "RENEE" and "  renee " all collapse to the same key, so a filter
 * matches regardless of how either side is cased or accented.
 */
export function normalizeFilterText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    // Strip combining diacritical marks (U+0300–U+036F) left behind by NFD.
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Params for AG Grid's `agTextColumnFilter`. `caseSensitive: false` is already
 * the AG Grid default — it is stated explicitly here so the behaviour is a
 * decision this codebase owns rather than one an upgrade could quietly change,
 * and `textFormatter` guarantees it either way.
 */
export const TEXT_FILTER_PARAMS = {
  caseSensitive: false,
  trimInput: true,
  textFormatter: normalizeFilterText,
  defaultOption: 'contains',
  debounceMs: 200,
};

/**
 * The `defaultColDef` every grid uses. Assign it directly — it is a stable
 * module-level reference, so the `useMemo` the grids used to wrap their local
 * literal in is no longer needed.
 */
export const GRID_DEFAULT_COL_DEF = {
  resizable: true,
  suppressMovable: false,
  filterParams: TEXT_FILTER_PARAMS,
  cellStyle: { fontSize: '13px', color: '#0F172A' },
};
