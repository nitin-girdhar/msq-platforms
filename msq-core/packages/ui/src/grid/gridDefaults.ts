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
  cellStyle: { fontSize: '0.8125rem', color: 'var(--color-on-surface)' },
  // AG Grid's own default minWidth is 20px. With `sizeColumnsToFit()` that let a
  // narrow viewport crush columns without an explicit floor to ~40px (Cycle 10:
  // "Follow-up Required" at 45px, Team "Status" at 44px). Every column now has a
  // 120px floor unless it sets its own; below the summed floors the grid scrolls
  // sideways instead.
  minWidth: 120,
  // Long labels ("Follow-up Required") wrap in the header rather than truncate.
  wrapHeaderText: true,
  autoHeaderHeight: true,
};

/**
 * Column sizing presets — one policy for every grid so columns look the same
 * across screens. Spread into a column def: `{ colId, headerName, ...GRID_COL.text }`.
 *
 *   text     equal-share flexible column (names, descriptions, FK labels)
 *   wide     the primary text column; takes twice a `text` share
 *   badge    status / boolean / chip columns: fixed range, never stretches
 *   number   counts, ranks, sort order
 *   date     dates / timestamps
 *   actions  pinned right row-action column, exact width
 *
 * Fixed-range columns do not grow when the screen is wide, so the slack goes to
 * the `text` columns evenly — a Status chip is never wider than the Name beside it.
 */
export const GRID_COL = {
  text: { flex: 1, minWidth: 160 },
  wide: { flex: 2, minWidth: 220 },
  badge: { width: 130, minWidth: 120, maxWidth: 170 },
  number: { width: 110, minWidth: 100, maxWidth: 140 },
  date: { width: 170, minWidth: 150, maxWidth: 210 },
  actions: (width = 100) => ({
    width, minWidth: width, maxWidth: width,
    pinned: 'right' as const, resizable: false, sortable: false, filter: false, editable: false,
  }),
};

/**
 * Scale a design-time pixel size (grid rowHeight / headerHeight, which AG Grid
 * takes as numbers) by the user's text size, so rows grow with the type inside
 * them. Reads the live <html> font-size; the grid mounts client-side after the
 * theme has applied, and a text-size change reloads the page.
 */
export function scalePx(px: number): number {
  if (typeof document === 'undefined') return px;
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? Math.round((px * root) / 16) : px;
}
