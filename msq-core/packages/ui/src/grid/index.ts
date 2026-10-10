// `@platform/ui-kit/grid` — AG Grid configuration shared by every grid in the
// platform. Kept off the root barrel so apps without a grid never pull it in.
export {
  GRID_DEFAULT_COL_DEF,
  GRID_COL,
  TEXT_FILTER_PARAMS,
  normalizeFilterText,
  scalePx,
} from './gridDefaults';
