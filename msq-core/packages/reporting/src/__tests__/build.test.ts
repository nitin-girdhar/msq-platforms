import { describe, expect, it } from 'vitest';
import { buildReportQuery } from '../sql/build.js';
import { ReportError } from '../sql/errors.js';
import { AGG_FNS, DATE_BUCKETS, type AggFn, type DateBucket } from '../spec/types.js';
import { LIMITS } from '../spec/limits.js';
import {
  ORG_ID,
  TENANT_ID,
  USER_ID,
  actor,
  clause,
  ctxFor,
  factDataset,
  leadsDataset,
  narrowDataset,
  orgActor,
  ownActor,
  render,
  specFor,
  teamActor,
} from './fixtures.js';

describe('buildReportQuery — shape', () => {
  it('emits a grouped aggregate with positional aliases', () => {
    const built = buildReportQuery(leadsDataset, specFor(), ctxFor(orgActor));
    const { text, params } = render(built.query);

    expect(text).toContain('COUNT(*)::int AS m0');
    expect(text).toContain('stage AS d0');
    expect(text).toContain('stage_label AS d0_label');
    expect(text).toContain('FROM test.vw_leads');
    expect(text).toContain('GROUP BY');
    expect(text).toContain('ORDER BY');
    // The client's measure id is never a SQL alias.
    expect(text).not.toContain('m1');
    // org id and the +1 truncation sentinel are both bound.
    expect(params).toContain(ORG_ID);
    expect(params).toContain(LIMITS.defaultGroups + 1);
  });

  it('omits GROUP BY and LIMIT for a KPI spec with no dimensions', () => {
    const built = buildReportQuery(
      leadsDataset,
      specFor({ rows: [], chart: { type: 'kpi', encoding: { measures: ['m1'] } } }),
      ctxFor(orgActor),
    );
    const { text } = render(built.query);
    expect(text).not.toContain('GROUP BY');
    expect(text).not.toContain('LIMIT');
  });

  it('always ANDs the org predicate and the base predicate', () => {
    const { text, params } = render(
      buildReportQuery(leadsDataset, specFor(), ctxFor(orgActor)).query,
    );
    expect(text).toContain('org_id = $1::uuid');
    expect(text).toContain('NOT is_deleted');
    expect(params[0]).toBe(ORG_ID);
  });

  it('groups the key and label by ordinal, and a declared sortExpr by expression', () => {
    // 1 = stage, 2 = stage_label. `stage_sort` is not in the SELECT list so it
    // cannot be an ordinal — re-emitting it is safe because a sortExpr is a plain
    // column reference carrying no bound parameter.
    const { text } = render(buildReportQuery(leadsDataset, specFor(), ctxFor(orgActor)).query);
    expect(clause(text, 'GROUP BY').trim()).toBe('1, 2, stage_sort');
  });

  it('groups a dimension with no sortExpr by ordinal alone', () => {
    const { text } = render(
      buildReportQuery(leadsDataset, specFor({ rows: [{ field: 'source' }] }), ctxFor(orgActor))
        .query,
    );
    expect(clause(text, 'GROUP BY').trim()).toBe('1');
  });

  it('clamps limit to maxGroups and reports the executed value', () => {
    const built = buildReportQuery(
      leadsDataset,
      specFor({ limit: LIMITS.maxGroups + 5000 }),
      ctxFor(orgActor),
    );
    expect(built.limit).toBe(LIMITS.maxGroups);
    expect(built.spec.limit).toBe(LIMITS.maxGroups);
    expect(render(built.query).params).toContain(LIMITS.maxGroups + 1);
  });

  it('rejects a spec whose dataset key does not match the resolved dataset', () => {
    expect(() =>
      buildReportQuery(leadsDataset, specFor({ dataset: 'test.other' }), ctxFor(orgActor)),
    ).toThrow(/targets dataset/);
  });
});

describe('buildReportQuery — aggregation matrix', () => {
  const aggField: Record<AggFn, string> = {
    count: '*',
    count_distinct: 'lead_id',
    sum: 'amount',
    avg: 'amount',
    min: 'amount',
    max: 'amount',
  };
  const expected: Record<AggFn, string> = {
    count: 'COUNT(*)::int',
    count_distinct: 'COUNT(DISTINCT lead_id)::int',
    sum: 'SUM(amount)::float8',
    avg: 'AVG(amount)::float8',
    min: 'MIN(amount)',
    max: 'MAX(amount)',
  };

  for (const agg of AGG_FNS) {
    it(`emits ${agg}`, () => {
      const built = buildReportQuery(
        leadsDataset,
        specFor({ measures: [{ id: 'm1', field: aggField[agg], agg }] }),
        ctxFor(orgActor),
      );
      expect(render(built.query).text).toContain(`${expected[agg]} AS m0`);
    });
  }

  it('rejects an aggregation the measure does not permit', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ measures: [{ id: 'm1', field: 'lead_id', agg: 'sum' }] }),
        ctxFor(orgActor),
      ),
    ).toThrow(/not available for/);
  });

  it("rejects a non-count aggregation on the reserved '*' measure", () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ measures: [{ id: 'm1', field: '*', agg: 'avg' }] }),
        ctxFor(orgActor),
      ),
    ).toThrow(/not available for|only 'count'/);
  });

  it('rejects an unknown measure field', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ measures: [{ id: 'm1', field: 'salary', agg: 'sum' }] }),
        ctxFor(orgActor),
      ),
    ).toThrow(/Unknown value field/);
  });
});

describe('buildReportQuery — date bucketing', () => {
  for (const bucket of DATE_BUCKETS) {
    it(`buckets by ${bucket} in the org timezone`, () => {
      const built = buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'created_at', bucket }] }),
        ctxFor(orgActor),
      );
      const { text, params } = render(built.query);
      expect(text).toContain(`date_trunc('${bucket}', created_at AT TIME ZONE $`);
      // The zone is a PARAMETER; only the granularity is source text.
      expect(params).toContain('Asia/Kolkata');
    });
  }

  it('honours an explicit spec timezone over the org default', () => {
    const built = buildReportQuery(
      leadsDataset,
      specFor({ rows: [{ field: 'created_at', bucket: 'day' }], timezone: 'America/New_York' }),
      ctxFor(orgActor),
    );
    expect(render(built.query).params).toContain('America/New_York');
    expect(built.timezone).toBe('America/New_York');
  });

  it('falls back to the default zone when neither spec nor org supplies one', () => {
    // Destructured away rather than passed as undefined: under
    // exactOptionalPropertyTypes an explicit undefined is not the same as absent,
    // and "absent" is the case being tested.
    const { orgTimezone: _omitted, ...noOrgTz } = ctxFor(orgActor);
    const built = buildReportQuery(
      leadsDataset,
      specFor({ rows: [{ field: 'created_at', bucket: 'day' }] }),
      noOrgTz,
    );
    expect(built.timezone).toBe('Asia/Kolkata');
  });

  it('rejects an invalid org timezone (which zod never validated)', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'created_at', bucket: 'day' }] }),
        ctxFor(orgActor, { orgTimezone: 'Mars/Olympus_Mons' }),
      ),
    ).toThrow(/not a valid IANA time zone/);
  });

  it('rejects a bucket the dimension does not declare', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        // closed_on declares only day + month.
        specFor({ rows: [{ field: 'closed_on', bucket: 'quarter' }] }),
        ctxFor(orgActor),
      ),
    ).toThrow(/does not support the 'quarter' bucket/);
  });

  it('rejects a bucket on a non-temporal dimension', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'stage', bucket: 'month' as DateBucket }] }),
        ctxFor(orgActor),
      ),
    ).toThrow(/not a date field/);
  });

  it('rejects a temporal dimension with no bucket rather than grouping raw timestamps', () => {
    expect(() =>
      buildReportQuery(leadsDataset, specFor({ rows: [{ field: 'created_at' }] }), ctxFor(orgActor)),
    ).toThrow(/needs a bucket/);
  });

  // ── Regression: the bug a real database found and 279 unit tests did not ──
  //
  // Re-emitting a bucketed date expression in GROUP BY produced
  //   SELECT   date_trunc('month', created_at AT TIME ZONE $1) AS d0
  //   GROUP BY date_trunc('month', created_at AT TIME ZONE $6)
  // because drizzle emits a fresh placeholder per interpolation. Postgres compares
  // GROUP BY to SELECT syntactically, so it rejected every time-series report with
  // `column "created_at" must appear in the GROUP BY clause`. Ordinals fix it by
  // emitting the parameter-carrying expression exactly once.
  it('binds the timezone exactly once for a bucketed query', () => {
    const { params } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'created_at', bucket: 'month' }], columns: [{ field: 'source' }] }),
        ctxFor(orgActor),
      ).query,
    );
    expect(params.filter((p) => p === 'Asia/Kolkata')).toHaveLength(1);
  });

  it('references the bucketed date by ordinal in GROUP BY and ORDER BY', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'created_at', bucket: 'month' }] }),
        ctxFor(orgActor),
      ).query,
    );
    // date_trunc appears once, in the SELECT list, and nowhere else.
    expect(text.match(/date_trunc/g)).toHaveLength(1);
    expect(clause(text, 'GROUP BY').trim()).toBe('1');
    expect(clause(text, 'ORDER BY').trim()).toBe('1 ASC NULLS LAST');
  });

  it('sorts a bucketed dimension by its bucket ordinal, not the raw column', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'created_at', bucket: 'month' }] }),
        ctxFor(orgActor),
      ).query,
    );
    // Ordinal 1 IS the bucket expression; the raw column must not appear on its
    // own, or months would interleave.
    expect(clause(text, 'ORDER BY').trim()).toBe('1 ASC NULLS LAST');
    expect(clause(text, 'ORDER BY')).not.toContain('created_at');
  });
});

describe('buildReportQuery — dimensions', () => {
  it('rejects an unknown dimension', () => {
    expect(() =>
      buildReportQuery(leadsDataset, specFor({ rows: [{ field: 'nope' }] }), ctxFor(orgActor)),
    ).toThrow(/Unknown field 'nope'/);
  });

  it('rejects grouping a filter-only dimension', () => {
    expect(() =>
      buildReportQuery(leadsDataset, specFor({ rows: [{ field: 'email' }] }), ctxFor(orgActor)),
    ).toThrow(/cannot be grouped/);
  });

  it('allows filtering a filter-only dimension', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ filters: [{ field: 'email', op: 'contains', values: ['acme'] }] }),
        ctxFor(orgActor),
      ).query,
    );
    expect(text).toContain('ILIKE');
  });

  it('rejects a capability-gated dimension the actor lacks', () => {
    const err = (() => {
      try {
        buildReportQuery(leadsDataset, specFor({ rows: [{ field: 'deal_band' }] }), ctxFor(orgActor));
        return null;
      } catch (e) {
        return e as ReportError;
      }
    })();
    expect(err).toBeInstanceOf(ReportError);
    expect(err?.kind).toBe('forbidden');
    expect(err?.statusCode).toBe(403);
  });

  it('permits a capability-gated dimension the actor holds', () => {
    const privileged = actor(
      'lms.analytics.view',
      'lms.analytics.org.view',
      'lms.leads.view',
      'lms.leads.view.org',
    );
    const { text } = render(
      buildReportQuery(leadsDataset, specFor({ rows: [{ field: 'deal_band' }] }), ctxFor(privileged))
        .query,
    );
    expect(text).toContain('deal_band AS d0');
  });

  it('emits a column dimension as c0 with its own ordering', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'stage' }], columns: [{ field: 'source' }] }),
        ctxFor(orgActor),
      ).query,
    );
    expect(text).toContain('source AS c0');
    // stage has a declared sortExpr (re-emitted); source is output column 3, so
    // the series orders by that ordinal.
    expect(clause(text, 'ORDER BY').trim()).toBe('stage_sort ASC NULLS LAST, 3 ASC NULLS LAST');
  });
});

describe('buildReportQuery — scoping', () => {
  it("adds an owner predicate for scope 'own'", () => {
    const built = buildReportQuery(leadsDataset, specFor(), ctxFor(ownActor));
    const { text, params } = render(built.query);
    expect(built.appliedScope).toBe('own');
    expect(text).toContain('assigned_to = $');
    expect(params).toContain(USER_ID);
  });

  it("adds a team subquery for scope 'team'", () => {
    const built = buildReportQuery(leadsDataset, specFor(), ctxFor(teamActor));
    const { text, params } = render(built.query);
    expect(built.appliedScope).toBe('team');
    expect(text).toContain('iam.vw_user_team_members');
    expect(text).toContain('manager_id = $');
    // Scoped to THIS org, so a manager with reports in two orgs cannot pull the
    // other org's members in.
    expect(text).toContain('tm.org_id = $');
    expect(params).toContain(USER_ID);
  });

  it("adds no extra predicate for scope 'org'", () => {
    const built = buildReportQuery(leadsDataset, specFor(), ctxFor(orgActor));
    expect(built.appliedScope).toBe('org');
    expect(render(built.query).text).not.toContain('vw_user_team_members');
  });

  it('403s when the actor holds no scope under the operation', () => {
    const scopeless = actor('lms.analytics.view', 'lms.leads.view');
    expect(() => buildReportQuery(leadsDataset, specFor(), ctxFor(scopeless))).toThrow(
      /do not hold any scope/,
    );
  });

  it('403s rather than widening when the dataset cannot express the actor scope', () => {
    const spec = specFor({ dataset: 'test.narrow' });
    const err = (() => {
      try {
        buildReportQuery(narrowDataset, spec, ctxFor(ownActor));
        return null;
      } catch (e) {
        return e as ReportError;
      }
    })();
    expect(err?.kind).toBe('forbidden');
    // The critical assertion: it did NOT fall back to org-wide.
    expect(err?.message).toMatch(/cannot be filtered that way/);
  });

  it('403s on a dataset the actor lacks the capability for', () => {
    const outsider = actor('lms.leads.view', 'lms.leads.view.org');
    expect(() => buildReportQuery(leadsDataset, specFor(), ctxFor(outsider))).toThrow(
      /do not have access to the 'Test Leads' dataset/,
    );
  });

  it('uses the tenant column for a tenant-wide read by a tenant admin', () => {
    const built = buildReportQuery(
      leadsDataset,
      specFor(),
      ctxFor(orgActor, { role: 'tenant_admin', tenantWide: true }),
    );
    const { text, params } = render(built.query);
    expect(text).toContain('tenant_id = $1::uuid');
    expect(params[0]).toBe(TENANT_ID);
  });

  it('refuses a tenant-wide read for a non-tenant role', () => {
    expect(() =>
      buildReportQuery(leadsDataset, specFor(), ctxFor(orgActor, { tenantWide: true })),
    ).toThrow(/requires a tenant administrator/);
  });

  it('refuses a tenant-wide read on a dataset with no tenant column', () => {
    expect(() =>
      buildReportQuery(
        narrowDataset,
        specFor({ dataset: 'test.narrow' }),
        ctxFor(orgActor, { role: 'tenant_admin', tenantWide: true }),
      ),
    ).toThrow(/no tenant column/);
  });

  it('refuses to run with no org context', () => {
    expect(() => buildReportQuery(leadsDataset, specFor(), ctxFor(orgActor, { orgId: '' }))).toThrow(
      /requires an organization context/,
    );
  });
});

describe('buildReportQuery — required date range', () => {
  it('rejects a spec with no date filter on a requiresDateRange dataset', () => {
    expect(() =>
      buildReportQuery(factDataset, specFor({ dataset: 'test.facts' }), ctxFor(orgActor)),
    ).toThrow(/needs a date range/);
  });

  it.each(['gte', 'gt', 'between', 'last_n_days', 'this_period'] as const)(
    'accepts a %s filter as satisfying the range',
    (op) => {
      const values =
        op === 'between'
          ? ['2026-01-01', '2026-02-01']
          : op === 'last_n_days'
            ? [30]
            : op === 'this_period'
              ? undefined
              : ['2026-01-01'];
      const spec = specFor({
        dataset: 'test.facts',
        filters: [
          {
            field: 'created_at',
            op,
            ...(values !== undefined && { values }),
            ...(op === 'this_period' && { bucket: 'month' as const }),
          },
        ],
      });
      expect(() => buildReportQuery(factDataset, spec, ctxFor(orgActor))).not.toThrow();
    },
  );

  it('does not accept an upper-bound-only filter as a range', () => {
    // `lte` bounds only the future, which does nothing for the scan.
    const spec = specFor({
      dataset: 'test.facts',
      filters: [{ field: 'created_at', op: 'lte', values: ['2026-01-01'] }],
    });
    expect(() => buildReportQuery(factDataset, spec, ctxFor(orgActor))).toThrow(/needs a date range/);
  });
});

describe('buildReportQuery — ordering', () => {
  it('orders by an explicit measure using its output ordinal', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ orderBy: [{ ref: 'm1', kind: 'measure', dir: 'desc' }] }),
        ctxFor(orgActor),
      ).query,
    );
    // stage(1), stage_label(2), COUNT(3) — so the measure is ordinal 3. The
    // aggregate is emitted once, in the SELECT list.
    expect(clause(text, 'ORDER BY').trim()).toBe('3 DESC NULLS LAST');
    expect(text.match(/COUNT\(\*\)/g)).toHaveLength(1);
  });

  it('orders by an explicit dimension using its sortExpr', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ orderBy: [{ ref: 'stage', kind: 'dimension', dir: 'asc' }] }),
        ctxFor(orgActor),
      ).query,
    );
    expect(text).toContain('ORDER BY stage_sort ASC NULLS LAST');
  });

  it('honours a per-dimension measure sort when no explicit orderBy is given', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'stage', sort: { by: 'measure', measureId: 'm1', dir: 'desc' } }] }),
        ctxFor(orgActor),
      ).query,
    );
    expect(clause(text, 'ORDER BY').trim()).toBe('3 DESC NULLS LAST');
  });

  it('puts nulls last in both directions', () => {
    const asc = render(buildReportQuery(leadsDataset, specFor(), ctxFor(orgActor)).query).text;
    const desc = render(
      buildReportQuery(
        leadsDataset,
        specFor({ orderBy: [{ ref: 'stage', kind: 'dimension', dir: 'desc' }] }),
        ctxFor(orgActor),
      ).query,
    ).text;
    expect(asc).toContain('NULLS LAST');
    expect(desc).toContain('NULLS LAST');
  });

  it('rejects an orderBy referencing an unknown measure id', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ orderBy: [{ ref: 'mX', kind: 'measure', dir: 'asc' }] }),
        ctxFor(orgActor),
      ),
    ).toThrow(/Unknown value 'mX' in sort/);
  });
});
