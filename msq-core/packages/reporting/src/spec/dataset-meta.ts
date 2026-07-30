// ── The client-facing view of a dataset ──────────────────────────────────────
// Browser-safe. This is a DatasetDef with every SQL fragment removed and every
// capability-gated field filtered out for the asking actor — see
// `toDatasetMeta` in ../sql/registry.ts, which is the only thing that builds
// one.
//
// The invariant that makes the builder UI honest: if a field is absent from
// DatasetMeta, the field palette cannot offer it, so the user cannot construct
// a spec the compiler would reject. Anything the UI needs in order to keep the
// user inside the legal set belongs here.

import type { AggFn, DateBucket, FieldKind, MeasureFormat, ReportSpec } from './types.js';

export interface DimensionMeta {
  key: string;
  label: string;
  kind: FieldKind;
  /** Non-empty only for temporal kinds. The UI offers exactly these. */
  buckets?: readonly DateBucket[];
  /** False ⇒ filter-only: it may go in the filter editor but not on a shelf. */
  groupable: boolean;
  filterable: boolean;
  /** 'high' warns the UI to refuse charting (or force a topN) — grouping by a
   *  near-unique column returns tens of thousands of groups and kills the tab
   *  long before it troubles Postgres. */
  cardinality?: 'low' | 'high';
  description?: string;
}

export interface MeasureMeta {
  key: string;
  label: string;
  /** The ONLY aggregations legal for this field. A sum over a status id is
   *  arithmetic on a surrogate key, so datasets declare per-field allowlists
   *  rather than offering all six everywhere. */
  aggs: readonly AggFn[];
  defaultFormat?: MeasureFormat;
  description?: string;
}

export interface DatasetMeta {
  key: string;
  label: string;
  description: string;
  dimensions: readonly DimensionMeta[];
  measures: readonly MeasureMeta[];
  /** When true the compiler REJECTS a spec with no date-range filter on
   *  `dateField`, and the UI must pre-fill one. This is the guard that keeps an
   *  unbounded GROUP BY off a growing fact relation. */
  requiresDateRange: boolean;
  /** The dimension key a required date range applies to. */
  dateField?: string;
  /** Days the UI should pre-fill when it seeds that filter. */
  defaultWindowDays?: number;
  /** Server-suggested starting point for a new report on this dataset. */
  defaultSpec?: Partial<ReportSpec>;
}
