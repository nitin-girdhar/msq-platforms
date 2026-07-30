// ── Edge validation for a report spec ────────────────────────────────────────
// The first of the gates. This rejects malformed and oversized input with a
// usable message; the compiler in ../sql re-checks everything that matters
// against the DatasetDef, because a validator that ran is not the same as a
// validator that ran against the right dataset.
//
// Two deliberate choices:
//
// 1. `.strict()` everywhere — unknown keys are REJECTED, not stripped. A key
//    the server doesn't know means the client is a version ahead (or is
//    probing); silently dropping it produces a chart that answers a different
//    question than the one asked.
//
// 2. The parse helpers return a hand-constructed ReportSpec rather than
//    z.infer. Under `exactOptionalPropertyTypes`, z.infer gives `bucket?: X |
//    undefined`, which is not assignable to `bucket?: X`. Rebuilding with
//    conditional spreads keeps absent optionals genuinely absent, so a spec
//    round-trips through JSON without growing explicit-undefined keys.

import { z } from 'zod';
import { LIMITS } from './limits.js';
import {
  AGG_FNS,
  CHART_TYPES,
  DATE_BUCKETS,
  FILTER_ARITY,
  FILTER_OPS,
  MEASURE_FORMATS,
  SORT_DIRS,
  chartShapeError,
  type DimensionRef,
  type FilterClause,
  type FilterValue,
  type MeasureRef,
  type ReportOrderBy,
  type ReportSpec,
} from './types.js';

// A dataset key and a field key are resolved by exact match against a registry
// / DatasetDef, so their charset does not need to be SQL-safe — but keeping
// them boring makes an injection attempt fail here, with a clear message,
// rather than three layers down.
const identifierish = z
  .string()
  .min(1)
  .max(LIMITS.maxDatasetKeyLen)
  .regex(/^[a-z][a-z0-9_.]*$/, 'must be lower-case alphanumeric with _ or .');

/** Measure ids are the strictest: they key Records and appear in cell keys, so
 *  they must contain no '::' and no '.'. */
const measureId = z
  .string()
  .min(1)
  .max(LIMITS.maxMeasureIdLen)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be lower-case alphanumeric with _');

const label = z.string().min(1).max(LIMITS.maxLabelLen);

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex colour');

const measureFormatSchema = z
  .object({
    kind: z.enum(MEASURE_FORMATS),
    decimals: z.number().int().min(0).max(6).optional(),
  })
  .strict();

const dimensionSortSchema = z
  .object({
    by: z.enum(['key', 'measure']),
    measureId: measureId.optional(),
    dir: z.enum(SORT_DIRS),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.by === 'measure' && v.measureId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sort.measureId is required when sorting by a measure',
      });
    }
  });

const dimensionRefSchema = z
  .object({
    field: identifierish,
    bucket: z.enum(DATE_BUCKETS).optional(),
    label: label.optional(),
    sort: dimensionSortSchema.optional(),
    topN: z.number().int().min(1).max(100).optional(),
    topNMeasure: measureId.optional(),
  })
  .strict();

const measureRefSchema = z
  .object({
    id: measureId,
    // '*' is the reserved count-rows field; the compiler checks it pairs with
    // agg 'count'.
    field: z.union([z.literal('*'), identifierish]),
    agg: z.enum(AGG_FNS),
    label: label.optional(),
    format: measureFormatSchema.optional(),
  })
  .strict();

const filterValueSchema = z.union([
  z.string().max(LIMITS.maxFilterTextLen),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const filterClauseSchema = z
  .object({
    field: identifierish,
    op: z.enum(FILTER_OPS),
    values: z.array(filterValueSchema).max(LIMITS.maxFilterValues).optional(),
    bucket: z.enum(DATE_BUCKETS).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const arity = FILTER_ARITY[v.op];
    const count = v.values?.length ?? 0;
    if (count < arity.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `filter '${v.op}' needs at least ${arity.min} value(s), got ${count}`,
      });
    }
    if (arity.max !== null && count > arity.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `filter '${v.op}' takes at most ${arity.max} value(s), got ${count}`,
      });
    }
    if (arity.requiresBucket && v.bucket === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `filter '${v.op}' requires a bucket`,
      });
    }
    if (v.op === 'last_n_days') {
      const n = v.values?.[0];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3650) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'last_n_days takes a single integer between 1 and 3650',
        });
      }
    }
    if ((v.op === 'contains' || v.op === 'starts_with') && typeof v.values?.[0] !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `filter '${v.op}' takes a single string value`,
      });
    }
  });

const chartEncodingSchema = z
  .object({
    xFromRow: z.number().int().min(0).max(LIMITS.maxRowDims - 1).optional(),
    measures: z.array(measureId).max(LIMITS.maxMeasures),
    xMeasure: measureId.optional(),
    stacked: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    showDataLabels: z.boolean().optional(),
    yAxisLabel: label.optional(),
    colorOverrides: z.record(z.string().max(LIMITS.maxLabelLen), hexColor).optional(),
  })
  .strict();

const orderBySchema = z
  .object({
    ref: z.string().min(1).max(LIMITS.maxDatasetKeyLen),
    kind: z.enum(['dimension', 'measure']),
    dir: z.enum(SORT_DIRS),
  })
  .strict();

export const reportSpecSchema = z
  .object({
    version: z.literal(1),
    dataset: identifierish,
    rows: z.array(dimensionRefSchema).max(LIMITS.maxRowDims),
    columns: z.array(dimensionRefSchema).max(LIMITS.maxColumnDims),
    measures: z.array(measureRefSchema).min(1).max(LIMITS.maxMeasures),
    filters: z.array(filterClauseSchema).max(LIMITS.maxFilters),
    orderBy: z.array(orderBySchema).max(LIMITS.maxRowDims + LIMITS.maxMeasures).optional(),
    limit: z.number().int().min(1).max(LIMITS.maxGroups).optional(),
    chart: z
      .object({
        type: z.enum(CHART_TYPES),
        encoding: chartEncodingSchema,
      })
      .strict(),
    // Validated as a real zone here so the compiler can bind it without further
    // thought — see isValidTimeZone for why this is not an allowlist check.
    timezone: z
      .string()
      .max(64)
      .refine(isValidTimeZone, 'must be a valid IANA time zone')
      .optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const ids = spec.measures.map((m) => m.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate measure id(s): ${[...new Set(dupes)].join(', ')}`,
      });
    }

    // Every id referenced anywhere must exist in spec.measures. Catching this
    // here means the compiler and the chart can both assume referential
    // integrity.
    const known = new Set(ids);
    const refs: Array<{ id: string | undefined; where: string }> = [
      ...spec.chart.encoding.measures.map((id, i) => ({ id, where: `chart.encoding.measures[${i}]` })),
      { id: spec.chart.encoding.xMeasure, where: 'chart.encoding.xMeasure' },
      ...[...spec.rows, ...spec.columns].flatMap((d, i) => [
        { id: d.sort?.measureId, where: `dimension[${i}].sort.measureId` },
        { id: d.topNMeasure, where: `dimension[${i}].topNMeasure` },
      ]),
      ...(spec.orderBy ?? [])
        .filter((o) => o.kind === 'measure')
        .map((o, i) => ({ id: o.ref, where: `orderBy[${i}].ref` })),
    ];
    for (const r of refs) {
      if (r.id !== undefined && !known.has(r.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${r.where} references unknown measure id '${r.id}'`,
        });
      }
    }

    if (spec.chart.encoding.xFromRow !== undefined && spec.chart.encoding.xFromRow >= spec.rows.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `chart.encoding.xFromRow (${spec.chart.encoding.xFromRow}) is out of range for ${spec.rows.length} row field(s)`,
      });
    }

    // A pre-flight cell-count bound that needs no DB round trip: measures ×
    // requested groups. The real check (which knows the series count) happens
    // after the query, but rejecting the obviously-impossible here is free.
    const requested = spec.limit ?? LIMITS.defaultGroups;
    if (requested * spec.measures.length > LIMITS.maxCells) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `limit ${requested} × ${spec.measures.length} measures exceeds the ${LIMITS.maxCells}-cell ceiling`,
      });
    }
  });

/**
 * Is this a time zone ICU (and therefore Postgres) will accept?
 *
 * Validated by CONSTRUCTING a DateTimeFormat, which throws RangeError on an
 * unknown zone. Deliberately NOT `Intl.supportedValuesOf('timeZone').includes()`:
 * that list contains only the canonical name for each zone as of the linked ICU,
 * and which name is canonical changes between ICU versions. On Node 22 here it
 * returns 'Asia/Calcutta' and omits 'Asia/Kolkata' — the exact string that is
 * the DEFAULT on entity.organizations.timezone (db_scripts/02_schema.sql:298).
 * An allowlist that rejects every org's real timezone is worse than no
 * allowlist, and it would have failed only once deployed.
 *
 * This is a usability gate, not a security one: the zone is always a bound
 * parameter (see buckets.ts), so its only job is to turn a typo into a clear
 * 400 instead of a Postgres error.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface SpecParseFailure {
  ok: false;
  /** Flattened `path: message` lines, safe to return to the client. */
  errors: string[];
}
export interface SpecParseSuccess {
  ok: true;
  spec: ReportSpec;
}
export type SpecParseResult = SpecParseSuccess | SpecParseFailure;

/**
 * Validate untrusted input into a ReportSpec.
 *
 * Use this on EVERY entry point, including reading a saved definition's JSONB
 * back out of the database: a row written before a registry change, or edited
 * out of band, is untrusted input exactly like a request body.
 */
export function parseReportSpec(input: unknown): SpecParseResult {
  const parsed = reportSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => {
        const path = i.path.join('.');
        return path === '' ? i.message : `${path}: ${i.message}`;
      }),
    };
  }
  const spec = normalizeSpec(parsed.data);
  const shape = chartShapeError(spec);
  if (shape !== null) return { ok: false, errors: [`chart: ${shape}`] };
  return { ok: true, spec };
}

// ── zod output → ReportSpec, with absent optionals kept absent ───────────────
// Verbose on purpose. `exactOptionalPropertyTypes` is the reason, and the
// alternative (casting z.infer to ReportSpec) would let an explicit-undefined
// key reach the compiler, where `'bucket' in dim` checks would then lie.

type ZodSpec = z.infer<typeof reportSpecSchema>;

function normalizeSpec(v: ZodSpec): ReportSpec {
  return {
    version: 1,
    dataset: v.dataset,
    rows: v.rows.map(normalizeDimension),
    columns: v.columns.map(normalizeDimension),
    measures: v.measures.map(normalizeMeasure),
    filters: v.filters.map(normalizeFilter),
    ...(v.orderBy !== undefined && { orderBy: v.orderBy.map(normalizeOrderBy) }),
    ...(v.limit !== undefined && { limit: v.limit }),
    chart: {
      type: v.chart.type,
      encoding: {
        ...(v.chart.encoding.xFromRow !== undefined && { xFromRow: v.chart.encoding.xFromRow }),
        measures: [...v.chart.encoding.measures],
        ...(v.chart.encoding.xMeasure !== undefined && { xMeasure: v.chart.encoding.xMeasure }),
        ...(v.chart.encoding.stacked !== undefined && { stacked: v.chart.encoding.stacked }),
        ...(v.chart.encoding.showLegend !== undefined && { showLegend: v.chart.encoding.showLegend }),
        ...(v.chart.encoding.showDataLabels !== undefined && {
          showDataLabels: v.chart.encoding.showDataLabels,
        }),
        ...(v.chart.encoding.yAxisLabel !== undefined && { yAxisLabel: v.chart.encoding.yAxisLabel }),
        ...(v.chart.encoding.colorOverrides !== undefined && {
          colorOverrides: { ...v.chart.encoding.colorOverrides },
        }),
      },
    },
    ...(v.timezone !== undefined && { timezone: v.timezone }),
  };
}

function normalizeDimension(d: ZodSpec['rows'][number]): DimensionRef {
  return {
    field: d.field,
    ...(d.bucket !== undefined && { bucket: d.bucket }),
    ...(d.label !== undefined && { label: d.label }),
    ...(d.sort !== undefined && {
      sort: {
        by: d.sort.by,
        ...(d.sort.measureId !== undefined && { measureId: d.sort.measureId }),
        dir: d.sort.dir,
      },
    }),
    ...(d.topN !== undefined && { topN: d.topN }),
    ...(d.topNMeasure !== undefined && { topNMeasure: d.topNMeasure }),
  };
}

function normalizeMeasure(m: ZodSpec['measures'][number]): MeasureRef {
  return {
    id: m.id,
    field: m.field,
    agg: m.agg,
    ...(m.label !== undefined && { label: m.label }),
    ...(m.format !== undefined && {
      format: {
        kind: m.format.kind,
        ...(m.format.decimals !== undefined && { decimals: m.format.decimals }),
      },
    }),
  };
}

function normalizeFilter(f: ZodSpec['filters'][number]): FilterClause {
  return {
    field: f.field,
    op: f.op,
    ...(f.values !== undefined && { values: [...f.values] as readonly FilterValue[] }),
    ...(f.bucket !== undefined && { bucket: f.bucket }),
  };
}

function normalizeOrderBy(o: NonNullable<ZodSpec['orderBy']>[number]): ReportOrderBy {
  return { ref: o.ref, kind: o.kind, dir: o.dir };
}
