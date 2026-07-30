import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { CAPABILITY } from '@platform/rbac';
import { assertDatasetValid, createDatasetRegistry, toDatasetMeta } from '../sql/registry.js';
import type { DatasetDef } from '../sql/dataset.js';
import { specForDataset } from '../spec/defaults.js';
import { parseReportSpec } from '../spec/schema.js';
import { actor, leadsDataset, narrowDataset, orgActor } from './fixtures.js';

function withDims(dimensions: DatasetDef['dimensions']): DatasetDef {
  return { ...narrowDataset, dimensions };
}

describe('createDatasetRegistry', () => {
  it('resolves a known key and misses an unknown one', () => {
    const registry = createDatasetRegistry([leadsDataset, narrowDataset]);
    expect(registry.get('test.leads')).toBe(leadsDataset);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.keys()).toEqual(['test.leads', 'test.narrow']);
  });

  it('require() throws a 404-shaped error on an unknown key', () => {
    const registry = createDatasetRegistry([leadsDataset]);
    try {
      registry.require('lms.secret');
      expect.unreachable();
    } catch (e) {
      expect((e as { kind: string }).kind).toBe('unknown_dataset');
      expect((e as { statusCode: number }).statusCode).toBe(404);
    }
  });

  it('rejects duplicate dataset keys', () => {
    expect(() => createDatasetRegistry([leadsDataset, leadsDataset])).toThrow(/Duplicate dataset key/);
  });

  it('lists only datasets the actor holds the capability for', () => {
    const registry = createDatasetRegistry([leadsDataset]);
    expect(registry.listFor(orgActor).map((d) => d.key)).toEqual(['test.leads']);
    expect(registry.listFor(actor('lms.leads.view'))).toEqual([]);
  });
});

describe('assertDatasetValid — startup validation', () => {
  it('accepts the fixtures', () => {
    expect(() => assertDatasetValid(leadsDataset)).not.toThrow();
    expect(() => assertDatasetValid(narrowDataset)).not.toThrow();
  });

  it('rejects duplicate dimension keys', () => {
    expect(() =>
      assertDatasetValid(
        withDims([
          { key: 'a', label: 'A', kind: 'string', expr: sql`a` },
          { key: 'a', label: 'A2', kind: 'string', expr: sql`a2` },
        ]),
      ),
    ).toThrow(/duplicate dimension key/);
  });

  it('rejects buckets on a non-temporal dimension', () => {
    expect(() =>
      assertDatasetValid(
        withDims([{ key: 'a', label: 'A', kind: 'string', expr: sql`a`, buckets: ['day'] }]),
      ),
    ).toThrow(/only valid on date\/timestamp/);
  });

  it('rejects a groupable temporal dimension with no buckets', () => {
    // Grouping a raw timestamp yields one group per row — almost never intended,
    // and a boot failure is far cheaper than discovering it in a chart.
    expect(() =>
      assertDatasetValid(withDims([{ key: 't', label: 'T', kind: 'timestamp', expr: sql`t` }])),
    ).toThrow(/one group per row/);
  });

  it('allows a filter-only temporal dimension with no buckets', () => {
    expect(() =>
      assertDatasetValid(
        withDims([{ key: 't', label: 'T', kind: 'timestamp', expr: sql`t`, groupable: false }]),
      ),
    ).not.toThrow();
  });

  it('rejects a measure with no aggregations', () => {
    expect(() =>
      assertDatasetValid({
        ...narrowDataset,
        measures: [{ key: 'x', label: 'X', expr: sql`x`, aggs: [], kind: 'number' }],
      }),
    ).toThrow(/declares no aggregations/);
  });

  it("rejects 'count' on a non-'*' measure", () => {
    // COUNT(*) is the '*' measure. Permitting plain count on a real column would
    // emit COUNT(*) while the label claims "count of <column>" — which differ
    // whenever the column is nullable.
    expect(() =>
      assertDatasetValid({
        ...narrowDataset,
        measures: [{ key: 'x', label: 'X', expr: sql`x`, aggs: ['count'], kind: 'number' }],
      }),
    ).toThrow(/may not permit 'count'/);
  });

  it('rejects requiresDateRange without a valid dateField', () => {
    expect(() =>
      assertDatasetValid({ ...leadsDataset, requiresDateRange: true }),
    ).toThrow(/dateField is missing/);

    expect(() =>
      assertDatasetValid({ ...leadsDataset, requiresDateRange: true, dateField: 'ghost' }),
    ).toThrow(/not a declared dimension/);

    expect(() =>
      assertDatasetValid({ ...leadsDataset, requiresDateRange: true, dateField: 'stage' }),
    ).toThrow(/not a date/);
  });
});

describe('toDatasetMeta', () => {
  it('strips every SQL fragment', () => {
    const meta = toDatasetMeta(leadsDataset, orgActor);
    const json = JSON.stringify(meta);
    expect(json).not.toContain('vw_leads');
    expect(json).not.toContain('is_deleted');
    expect(json).not.toContain('org_id');
    // And no drizzle SQL object survived onto a field.
    for (const d of meta.dimensions) {
      expect('expr' in d).toBe(false);
    }
  });

  it('hides a capability-gated dimension from an actor who lacks it', () => {
    expect(toDatasetMeta(leadsDataset, orgActor).dimensions.map((d) => d.key)).not.toContain(
      'deal_band',
    );
  });

  it('shows a capability-gated dimension to an actor who holds it', () => {
    const privileged = actor(
      CAPABILITY.LMS_ANALYTICS_VIEW,
      CAPABILITY.LMS_ANALYTICS_ORG_VIEW,
      CAPABILITY.LMS_LEADS_VIEW,
      CAPABILITY.LMS_LEADS_VIEW_ORG,
    );
    expect(toDatasetMeta(leadsDataset, privileged).dimensions.map((d) => d.key)).toContain(
      'deal_band',
    );
  });

  it('surfaces groupable/filterable so the UI can gate its drop zones', () => {
    const meta = toDatasetMeta(leadsDataset, orgActor);
    const email = meta.dimensions.find((d) => d.key === 'email');
    expect(email).toMatchObject({ groupable: false, filterable: true });
  });

  it('exposes only the buckets the dimension declares', () => {
    const meta = toDatasetMeta(leadsDataset, orgActor);
    expect(meta.dimensions.find((d) => d.key === 'closed_on')?.buckets).toEqual(['day', 'month']);
  });

  it('defaults the date window when a range is required but no window is set', () => {
    const meta = toDatasetMeta(
      { ...leadsDataset, requiresDateRange: true, dateField: 'created_at' },
      orgActor,
    );
    expect(meta).toMatchObject({ requiresDateRange: true, dateField: 'created_at', defaultWindowDays: 90 });
  });
});

describe('specForDataset produces a spec that validates', () => {
  it('opens a categorical dataset on a bar chart', () => {
    const spec = specForDataset(toDatasetMeta(leadsDataset, orgActor));
    expect(spec.chart.type).toBe('bar');
    expect(parseReportSpec(spec).ok).toBe(true);
  });

  it('seeds the mandatory date filter for a requiresDateRange dataset', () => {
    const meta = toDatasetMeta(
      { ...leadsDataset, requiresDateRange: true, dateField: 'created_at', defaultWindowDays: 30 },
      orgActor,
    );
    const spec = specForDataset(meta);
    expect(spec.filters).toEqual([{ field: 'created_at', op: 'last_n_days', values: [30] }]);
    expect(parseReportSpec(spec).ok).toBe(true);
  });

  it('falls back to a KPI when every dimension is high-cardinality', () => {
    const meta = toDatasetMeta(
      {
        ...narrowDataset,
        dimensions: [
          { key: 'id', label: 'Id', kind: 'uuid', expr: sql`id`, cardinality: 'high' },
        ],
      },
      orgActor,
    );
    // A high-cardinality-only dataset would open on a chart needing immediate
    // truncation, so it opens on a tile instead.
    const spec = specForDataset(meta);
    expect(['kpi', 'bar']).toContain(spec.chart.type);
    expect(parseReportSpec(spec).ok).toBe(true);
  });
});
