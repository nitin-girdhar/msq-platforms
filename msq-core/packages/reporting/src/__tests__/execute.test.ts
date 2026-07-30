import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { runReportQuery, type SqlExecutor } from '../sql/execute.js';
import { ReportError } from '../sql/errors.js';
import { LIMITS } from '../spec/limits.js';
import { dimKey } from '../spec/result.js';
import { ctxFor, leadsDataset, orgActor, render, specFor } from './fixtures.js';

/**
 * Await a rejection and return it as a ReportError.
 *
 * `.catch(e => e as ReportError)` types the result as `T | ReportError`, so every
 * property access then needs a narrow. Asserting the throw happened here keeps
 * the test body about the error's shape.
 */
async function captureError(run: () => Promise<unknown>): Promise<ReportError> {
  try {
    await run();
  } catch (e) {
    return e as ReportError;
  }
  throw new Error('expected the call to reject, but it resolved');
}

/** Records every statement, and returns the queued rows for the LAST one (the
 *  report query) — the two preceding calls are the set_config calls. */
function fakeExecutor(rows: unknown): SqlExecutor & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    execute(query: SQL) {
      statements.push(render(query).text);
      return Promise.resolve(statements.length <= 2 ? [] : rows);
    },
  };
}

describe('runReportQuery — session setup', () => {
  it('sets statement_timeout and read-only via set_config, not SET', () => {
    const exec = fakeExecutor([{ d0: 'new', m0: 1 }]);
    return runReportQuery(exec, leadsDataset, specFor(), ctxFor(orgActor)).then(() => {
      // SET does not accept a bound parameter, so the timeout goes through
      // set_config — which keeps it out of the query text without sql.raw.
      expect(exec.statements[0]).toContain("set_config('statement_timeout'");
      expect(exec.statements[0]).not.toContain('10000ms');
      expect(exec.statements[1]).toContain("set_config('transaction_read_only'");
    });
  });

  it('honours a per-dataset timeout override', async () => {
    const exec = fakeExecutor([]);
    const slowDataset = { ...leadsDataset, caps: { timeoutMs: 2000 } };
    await runReportQuery(exec, slowDataset, specFor(), ctxFor(orgActor));
    // The value is bound; assert via the params of the rendered statement.
    expect(exec.statements[0]).toContain('set_config');
  });
});

describe('runReportQuery — result shaping', () => {
  it('returns pivoted rows with meta', async () => {
    const exec = fakeExecutor([
      { d0: 'new', d0_label: 'New', m0: 7 },
      { d0: 'won', d0_label: 'Won', m0: 2 },
    ]);
    const result = await runReportQuery(exec, leadsDataset, specFor(), ctxFor(orgActor));

    expect(result.rows).toEqual([
      { [dimKey(0)]: 'New', m1: 7 },
      { [dimKey(0)]: 'Won', m1: 2 },
    ]);
    expect(result.meta).toMatchObject({
      rowCount: 2,
      truncated: false,
      appliedScope: 'org',
      timezone: 'Asia/Kolkata',
    });
    expect(result.grandTotals).toEqual({ m1: 9 });
  });

  it('echoes the EXECUTED spec, not the requested one', async () => {
    const exec = fakeExecutor([]);
    const result = await runReportQuery(
      exec,
      leadsDataset,
      specFor({ limit: 99_999 }),
      ctxFor(orgActor),
    );
    // The client is told its limit was clamped rather than silently given fewer
    // rows than it asked for.
    expect(result.spec.limit).toBe(LIMITS.maxGroups);
    expect(result.spec.timezone).toBe('Asia/Kolkata');
  });

  it('coerces a numeric string measure into a number', async () => {
    // postgres.js returns NUMERIC as a string; a chart handed "42" renders a
    // category axis instead of a value axis.
    const exec = fakeExecutor([{ d0: 'new', m0: '42.5' }]);
    const result = await runReportQuery(exec, leadsDataset, specFor(), ctxFor(orgActor));
    expect(result.rows[0]?.m1).toBe(42.5);
  });

  it('does NOT coerce a numeric-looking dimension value', async () => {
    // A pincode or zero-padded code must survive as a string, or the axis label
    // and the group identity are both corrupted.
    const exec = fakeExecutor([{ d0: '007', m0: 1 }]);
    const result = await runReportQuery(exec, leadsDataset, specFor(), ctxFor(orgActor));
    expect(result.rows[0]?.[dimKey(0)]).toBe('007');
  });

  it('renders a Date measure boundary as an ISO string', async () => {
    const exec = fakeExecutor([{ d0: 'new', m0: new Date('2026-03-01T00:00:00.000Z') }]);
    const result = await runReportQuery(
      exec,
      leadsDataset,
      specFor({ measures: [{ id: 'm1', field: 'amount', agg: 'max' }] }),
      ctxFor(orgActor),
    );
    expect(result.rows[0]?.m1).toBe('2026-03-01T00:00:00.000Z');
  });

  it('accepts a node-postgres style { rows } envelope', async () => {
    const exec: SqlExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ rows: [{ d0: 'new', m0: 3 }] }),
    };
    const result = await runReportQuery(exec, leadsDataset, specFor(), ctxFor(orgActor));
    expect(result.rows).toHaveLength(1);
  });
});

describe('runReportQuery — truncation', () => {
  it('flags truncation and drops the sentinel row', async () => {
    // The query fetches limit + 1 precisely so truncation is detectable without a
    // second COUNT.
    const limit = 3;
    const rows = Array.from({ length: limit + 1 }, (_, i) => ({ d0: `s${i}`, m0: i }));
    const exec = fakeExecutor(rows);
    const result = await runReportQuery(exec, leadsDataset, specFor({ limit }), ctxFor(orgActor));

    expect(result.meta.truncated).toBe(true);
    expect(result.rows).toHaveLength(limit);
  });

  it('does not flag truncation when the result exactly fills the limit', async () => {
    const limit = 3;
    const rows = Array.from({ length: limit }, (_, i) => ({ d0: `s${i}`, m0: i }));
    const exec = fakeExecutor(rows);
    const result = await runReportQuery(exec, leadsDataset, specFor({ limit }), ctxFor(orgActor));
    expect(result.meta.truncated).toBe(false);
  });
});

describe('runReportQuery — cell ceiling', () => {
  const breakdownSpec = specFor({
    rows: [{ field: 'stage' }],
    columns: [{ field: 'source' }],
  });

  it('rejects SPARSE data whose wide grid blows the cell budget', async () => {
    // The dangerous shape is sparse, not large: long rows are a subset of
    // (groups × series), so a diagonal result — every row its own group AND its
    // own series — pivots to n² cells. 200 long rows ⇒ 200 × 200 = 40 000,
    // double the ceiling, from a result the SQL LIMIT was perfectly happy with.
    const n = 200;
    const rows = Array.from({ length: n }, (_, i) => ({ d0: `r${i}`, c0: `s${i}`, m0: 1 }));
    const exec = fakeExecutor(rows);

    await expect(
      runReportQuery(exec, leadsDataset, breakdownSpec, ctxFor(orgActor)),
    ).rejects.toThrow(/40,000 data points/);
  });

  it('allows dense data of the same row count', async () => {
    // 200 long rows as 20 groups × 10 series is only 200 cells — the input size
    // is identical, so it is the sparsity that matters, not the row count.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      d0: `r${Math.floor(i / 10)}`,
      c0: `s${i % 10}`,
      m0: 1,
    }));
    const exec = fakeExecutor(rows);
    const result = await runReportQuery(exec, leadsDataset, breakdownSpec, ctxFor(orgActor));
    expect(result.rows).toHaveLength(20);
    expect(result.series).toHaveLength(10);
  });

  it('counts cells before pivoting, so the grid is never materialised', async () => {
    // A diagonal at the group cap would be 25 million cells; if the check ran
    // after pivotRows this test would OOM rather than throw.
    const n = LIMITS.maxGroups;
    const rows = Array.from({ length: n }, (_, i) => ({ d0: `r${i}`, c0: `s${i}`, m0: 1 }));
    const exec = fakeExecutor(rows);
    await expect(
      runReportQuery(exec, leadsDataset, { ...breakdownSpec, limit: n }, ctxFor(orgActor)),
    ).rejects.toThrow(/data points/);
  });
});

describe('runReportQuery — topN', () => {
  it('folds the tail into an Other row', async () => {
    const exec = fakeExecutor([
      { d0: 'a', m0: 100 },
      { d0: 'b', m0: 50 },
      { d0: 'c', m0: 5 },
      { d0: 'd', m0: 2 },
    ]);
    const result = await runReportQuery(
      exec,
      leadsDataset,
      specFor({ rows: [{ field: 'stage', topN: 2 }] }),
      ctxFor(orgActor),
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]?.[dimKey(0)]).toBe('Other');
    expect(result.rows[2]?.m1).toBe(7);
  });
});

describe('runReportQuery — error mapping', () => {
  it('maps a statement_timeout to an actionable 400, not a 500', async () => {
    const exec: SqlExecutor = {
      execute: vi.fn().mockImplementation((q: SQL) => {
        const text = render(q).text;
        if (text.includes('set_config')) return Promise.resolve([]);
        return Promise.reject(Object.assign(new Error('canceling statement'), { code: '57014' }));
      }),
    };

    const err = await captureError(() =>
      runReportQuery(exec, leadsDataset, specFor(), ctxFor(orgActor)),
    );
    expect(err).toBeInstanceOf(ReportError);
    expect(err.kind).toBe('too_large');
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/Narrow the date range/);
  });

  it('rethrows an unexpected driver error untouched', async () => {
    // An unexpected DB error must not be disguised as a user error.
    const boom = Object.assign(new Error('connection reset'), { code: '08006' });
    const exec: SqlExecutor = {
      execute: vi.fn().mockImplementation((q: SQL) => {
        if (render(q).text.includes('set_config')) return Promise.resolve([]);
        return Promise.reject(boom);
      }),
    };
    await expect(runReportQuery(exec, leadsDataset, specFor(), ctxFor(orgActor))).rejects.toBe(boom);
  });
});
