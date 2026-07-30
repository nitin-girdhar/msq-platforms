// ── The dataset registry ─────────────────────────────────────────────────────
// A frozen Map from dataset key to DatasetDef, built once at module load in
// each product service. `spec.dataset` is resolved through `get()` — a Map
// lookup, so an unknown key is a miss and never reaches SQL.
//
// The registry is per product on purpose. leads-service registers only lms.*
// datasets and runs as lms_svc, which has no USAGE on the hr schema
// (db_scripts/04_roles_and_grants.sql:529-553). That means the grant model stays
// a real boundary even if this whitelist were somehow bypassed.

import type { DatasetDef, DimensionDef, MeasureDef } from './dataset.js';
import { isFilterable, isGroupable } from './dataset.js';
import { ReportError } from './errors.js';
import { can, type CapabilityHolder } from '@platform/rbac';
import type { DatasetMeta, DimensionMeta, MeasureMeta } from '../spec/dataset-meta.js';
import { isTemporalKind } from '../spec/types.js';

export interface DatasetRegistry {
  /** Throws ReportError('unknown_dataset') on a miss — callers should not have
   *  to remember to null-check the security-relevant lookup. */
  require(key: string): DatasetDef;
  get(key: string): DatasetDef | undefined;
  /** Every dataset the actor may see, as client-safe metadata. */
  listFor(actor: CapabilityHolder): DatasetMeta[];
  keys(): string[];
}

/**
 * Build a registry, validating each definition's internal consistency at
 * startup.
 *
 * These checks run at module load, so a malformed dataset crashes the service
 * on boot rather than 500-ing one user's report at 3am. That is the right
 * trade: a dataset definition is source code, and a boot failure is a build
 * failure with a stack trace.
 */
export function createDatasetRegistry(defs: readonly DatasetDef[]): DatasetRegistry {
  const map = new Map<string, DatasetDef>();
  for (const def of defs) {
    if (map.has(def.key)) {
      throw new Error(`Duplicate dataset key '${def.key}' in registry`);
    }
    assertDatasetValid(def);
    map.set(def.key, def);
  }

  return {
    require(key) {
      const def = map.get(key);
      if (def === undefined) {
        throw new ReportError('unknown_dataset', `Unknown dataset '${key}'.`);
      }
      return def;
    },
    get: (key) => map.get(key),
    listFor: (actor) =>
      [...map.values()].filter((d) => can(actor, d.capability)).map((d) => toDatasetMeta(d, actor)),
    keys: () => [...map.keys()],
  };
}

/** Startup validation. Every failure here is a developer error in a dataset
 *  definition, phrased so it is obvious which file to open. */
export function assertDatasetValid(def: DatasetDef): void {
  const where = `dataset '${def.key}'`;

  const dimKeys = new Set<string>();
  for (const d of def.dimensions) {
    if (dimKeys.has(d.key)) throw new Error(`${where}: duplicate dimension key '${d.key}'`);
    dimKeys.add(d.key);

    const temporal = isTemporalKind(d.kind);
    const buckets = d.buckets ?? [];
    if (!temporal && buckets.length > 0) {
      throw new Error(
        `${where}: dimension '${d.key}' is kind '${d.kind}' but declares date buckets — buckets are only valid on date/timestamp fields`,
      );
    }
    if (temporal && isGroupable(d) && buckets.length === 0) {
      // A groupable timestamp with no bucket would group by the microsecond:
      // one group per row, every time. Almost certainly not intended.
      throw new Error(
        `${where}: temporal dimension '${d.key}' is groupable but declares no buckets — grouping raw timestamps yields one group per row`,
      );
    }
  }

  const measureKeys = new Set<string>();
  for (const m of def.measures) {
    if (measureKeys.has(m.key)) throw new Error(`${where}: duplicate measure key '${m.key}'`);
    measureKeys.add(m.key);
    if (m.aggs.length === 0) {
      throw new Error(`${where}: measure '${m.key}' declares no aggregations`);
    }
    if (m.key === '*' && !m.aggs.includes('count')) {
      throw new Error(`${where}: the reserved '*' measure must permit 'count'`);
    }
    if (m.key !== '*' && m.aggs.includes('count')) {
      // COUNT(*) is the '*' measure. Allowing plain 'count' on a real column
      // would emit COUNT(*) while the UI label says "count of <column>", which
      // differ whenever the column is nullable.
      throw new Error(
        `${where}: measure '${m.key}' may not permit 'count' — use 'count_distinct', or the reserved '*' measure for row counts`,
      );
    }
  }

  if (def.requiresDateRange === true) {
    if (def.dateField === undefined) {
      throw new Error(`${where}: requiresDateRange is set but dateField is missing`);
    }
    const dim = def.dimensions.find((d) => d.key === def.dateField);
    if (dim === undefined) {
      throw new Error(`${where}: dateField '${def.dateField}' is not a declared dimension`);
    }
    if (!isTemporalKind(dim.kind)) {
      throw new Error(`${where}: dateField '${def.dateField}' is kind '${dim.kind}', not a date`);
    }
    if (!isFilterable(dim)) {
      throw new Error(`${where}: dateField '${def.dateField}' must be filterable`);
    }
  }
}

/**
 * DatasetDef → DatasetMeta: strip every SQL fragment, drop every field the
 * actor may not use.
 *
 * The filtering is what keeps the builder honest. A field the actor cannot query
 * is absent from the palette, so they cannot place it, so they never see a 403
 * they can't explain. It is also a small information-disclosure guard: a
 * dimension named `salary_band` should not appear in an API response to someone
 * who lacks the capability to group by it.
 */
export function toDatasetMeta(def: DatasetDef, actor: CapabilityHolder): DatasetMeta {
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    dimensions: def.dimensions.filter((d) => permitted(d, actor)).map(dimensionMeta),
    measures: def.measures.filter((m) => permitted(m, actor)).map(measureMeta),
    requiresDateRange: def.requiresDateRange === true,
    ...(def.dateField !== undefined && { dateField: def.dateField }),
    ...(def.defaultWindowDays !== undefined && { defaultWindowDays: def.defaultWindowDays }),
    ...(def.requiresDateRange === true &&
      def.defaultWindowDays === undefined && { defaultWindowDays: 90 }),
    ...(def.defaultSpec !== undefined && { defaultSpec: def.defaultSpec }),
  };
}

function permitted(
  field: { requiresCapability?: DimensionDef['requiresCapability'] },
  actor: CapabilityHolder,
): boolean {
  return field.requiresCapability === undefined || can(actor, field.requiresCapability);
}

function dimensionMeta(d: DimensionDef): DimensionMeta {
  return {
    key: d.key,
    label: d.label,
    kind: d.kind,
    ...(d.buckets !== undefined && d.buckets.length > 0 && { buckets: d.buckets }),
    groupable: isGroupable(d),
    filterable: isFilterable(d),
    ...(d.cardinality !== undefined && { cardinality: d.cardinality }),
    ...(d.description !== undefined && { description: d.description }),
  };
}

function measureMeta(m: MeasureDef): MeasureMeta {
  return {
    key: m.key,
    label: m.label,
    aggs: m.aggs,
    ...(m.defaultFormat !== undefined && { defaultFormat: m.defaultFormat }),
    ...(m.description !== undefined && { description: m.description }),
  };
}

/**
 * Assert the actor may query this dataset at all.
 *
 * Separate from the route's `requireCapability` gate on purpose: the route
 * guards the ENDPOINT, this guards the DATASET. One product route serves every
 * dataset in its registry, so without this a user who can reach /query could
 * read any dataset the service registered.
 */
export function assertDatasetPermitted(def: DatasetDef, actor: CapabilityHolder): void {
  if (!can(actor, def.capability)) {
    throw new ReportError('forbidden', `You do not have access to the '${def.label}' dataset.`);
  }
}
