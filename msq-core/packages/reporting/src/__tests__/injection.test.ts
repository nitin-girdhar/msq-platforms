// ── The security suite ───────────────────────────────────────────────────────
// The claim under test: NO string from a ReportSpec can reach the SQL text. Every
// one either fails validation, or lands in the bound-parameter array.
//
// The assertion style matters. `expect(text).not.toContain(payload)` alone is
// weak — it passes when the payload was silently dropped, which would be a
// correctness bug wearing a security test's clothes. So each case asserts BOTH
// that the text is clean AND that the value is either rejected outright or
// present in `params`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReportQuery } from '../sql/build.js';
import { escapeLikePattern } from '../sql/filters.js';
import { parseReportSpec } from '../spec/schema.js';
import { ctxFor, leadsDataset, orgActor, render, specFor } from './fixtures.js';

/** Payloads aimed at identifier position, string values, and JS itself. */
const PAYLOADS = [
  `'; DROP TABLE lms.marketing_leads; --`,
  `x" OR 1=1 --`,
  `1) OR (1=1`,
  `stage; SELECT pg_sleep(10)`,
  `*/ UNION SELECT password_hash FROM iam.users --`,
  `%`,
  `_`,
  `\\`,
  `100%_\\`,
  `__proto__`,
  `constructor`,
  `prototype`,
  `Ｓtage`, // fullwidth homoglyph
  `stage\u202Eevil`, // RTL override
  `stage\u0000null`,
  `а`, // Cyrillic 'a'
  'x'.repeat(10_000),
] as const;

/**
 * Payloads distinctive enough that "absent from the query text" is a meaningful
 * assertion.
 *
 * `%`, `_` and `\` are excluded: `_` occurs in `stage_label`, so asserting the
 * rendered SQL does not contain it would fail on correct output while telling us
 * nothing about binding. Those three are still exercised — for parameter binding
 * via PAYLOADS below, and for LIKE escaping in their own test — just not with a
 * substring check that cannot tell an injection from an identifier.
 */
const DISTINCTIVE_PAYLOADS = PAYLOADS.filter((p) => p.length >= 4);

describe('injection — identifier positions are whitelist-resolved', () => {
  for (const payload of PAYLOADS) {
    it(`rejects a dataset key of ${describePayload(payload)}`, () => {
      // Either zod's charset rejects it, or the registry lookup misses. Both are
      // failures; neither produces SQL.
      expect(() =>
        buildReportQuery(leadsDataset, specFor({ dataset: payload }), ctxFor(orgActor)),
      ).toThrow();
    });

    it(`rejects a row field of ${describePayload(payload)}`, () => {
      expect(() =>
        buildReportQuery(leadsDataset, specFor({ rows: [{ field: payload }] }), ctxFor(orgActor)),
      ).toThrow(/Unknown field/);
    });

    it(`rejects a measure field of ${describePayload(payload)}`, () => {
      expect(() =>
        buildReportQuery(
          leadsDataset,
          specFor({ measures: [{ id: 'm1', field: payload, agg: 'count' }] }),
          ctxFor(orgActor),
        ),
      ).toThrow(/Unknown value field|not available for/);
    });

    it(`rejects a filter field of ${describePayload(payload)}`, () => {
      expect(() =>
        buildReportQuery(
          leadsDataset,
          specFor({ filters: [{ field: payload, op: 'eq', values: ['x'] }] }),
          ctxFor(orgActor),
        ),
      ).toThrow(/Unknown filter field/);
    });

    it(`rejects an orderBy ref of ${describePayload(payload)}`, () => {
      expect(() =>
        buildReportQuery(
          leadsDataset,
          specFor({ orderBy: [{ ref: payload, kind: 'dimension', dir: 'asc' }] }),
          ctxFor(orgActor),
        ),
      ).toThrow(/Unknown field/);
    });
  }

  it('rejects an aggregation outside the closed vocabulary', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        // Cast past the type system the way a raw JSON body would arrive.
        specFor({ measures: [{ id: 'm1', field: 'amount', agg: 'SUM(x); DROP' as never }] }),
        ctxFor(orgActor),
      ),
    ).toThrow();
  });

  it('rejects a bucket outside the closed vocabulary', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'created_at', bucket: "day'); DROP--" as never }] }),
        ctxFor(orgActor),
      ),
    ).toThrow();
  });

  it('rejects a filter op outside the closed vocabulary', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ filters: [{ field: 'stage', op: 'eq; DROP' as never, values: ['x'] }] }),
        ctxFor(orgActor),
      ),
    ).toThrow();
  });

  it('rejects a sort direction outside the closed vocabulary', () => {
    expect(() =>
      buildReportQuery(
        leadsDataset,
        specFor({ orderBy: [{ ref: 'stage', kind: 'dimension', dir: 'asc; DROP' as never }] }),
        ctxFor(orgActor),
      ),
    ).toThrow();
  });
});

describe('injection — values are bound, never interpolated', () => {
  for (const payload of PAYLOADS) {
    it(`binds an eq value of ${describePayload(payload)}`, () => {
      const { text, params } = render(
        buildReportQuery(
          leadsDataset,
          specFor({ filters: [{ field: 'stage', op: 'eq', values: [payload] }] }),
          ctxFor(orgActor),
        ).query,
      );
      // The value survived as DATA — this half is what makes the negative
      // assertion below meaningful rather than vacuously true.
      expect(params).toContain(payload);
      expect(text).toContain('stage = $');
      if (DISTINCTIVE_PAYLOADS.includes(payload)) {
        expect(text).not.toContain(payload);
      }
    });

    it(`binds an in-list containing ${describePayload(payload)}`, () => {
      const { text, params } = render(
        buildReportQuery(
          leadsDataset,
          specFor({ filters: [{ field: 'stage', op: 'in', values: ['ok', payload] }] }),
          ctxFor(orgActor),
        ).query,
      );
      expect(params).toContain(payload);
      expect(text).toContain('IN ($2::text, $3::text)');
      if (DISTINCTIVE_PAYLOADS.includes(payload)) {
        expect(text).not.toContain(payload);
      }
    });
  }

  it('binds a contains needle with LIKE metacharacters escaped', () => {
    const { text, params } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ filters: [{ field: 'stage', op: 'contains', values: ['100%_\\'] }] }),
        ctxFor(orgActor),
      ).query,
    );
    // The escaped pattern is a PARAMETER; only ESCAPE is source text.
    expect(params).toContain('%100\\%\\_\\\\%');
    expect(text).toContain("ESCAPE '\\'");
    expect(text).not.toContain('100%');
  });

  it('binds the timezone rather than interpolating it', () => {
    const { text, params } = render(
      buildReportQuery(
        leadsDataset,
        specFor({ rows: [{ field: 'created_at', bucket: 'month' }], timezone: 'Europe/Berlin' }),
        ctxFor(orgActor),
      ).query,
    );
    expect(params).toContain('Europe/Berlin');
    expect(text).not.toContain('Europe/Berlin');
  });

  it('never emits a client measure id into the query text', () => {
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({
          measures: [
            { id: 'sneaky_alias', field: '*', agg: 'count' },
            { id: 'other_one', field: 'amount', agg: 'sum' },
          ],
          chart: { type: 'bar', encoding: { measures: ['sneaky_alias'] } },
        }),
        ctxFor(orgActor),
      ).query,
    );
    expect(text).not.toContain('sneaky_alias');
    expect(text).not.toContain('other_one');
    // Positional aliases instead.
    expect(text).toContain('AS m0');
    expect(text).toContain('AS m1');
  });

  it('keeps presentation-only strings out of SQL entirely', () => {
    const evil = `'); DROP TABLE x; --`;
    const { text } = render(
      buildReportQuery(
        leadsDataset,
        specFor({
          rows: [{ field: 'stage', label: evil }],
          measures: [{ id: 'm1', field: '*', agg: 'count', label: evil }],
          chart: { type: 'bar', encoding: { measures: ['m1'], yAxisLabel: evil } },
        }),
        ctxFor(orgActor),
      ).query,
    );
    expect(text).not.toContain('DROP TABLE');
  });
});

describe('escapeLikePattern', () => {
  it('escapes the backslash first so it does not double-escape the others', () => {
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it.each([
    ['plain', 'plain'],
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['c:\\tmp', 'c:\\\\tmp'],
  ])('escapes %s', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });
});

describe('zod rejects malformed input before the compiler sees it', () => {
  it('rejects unknown keys rather than stripping them', () => {
    const result = parseReportSpec({ ...specFor(), sneaky: 'DROP TABLE x' });
    expect(result.ok).toBe(false);
  });

  it('rejects a prototype-polluting measure id', () => {
    const result = parseReportSpec(specFor({ measures: [{ id: '__proto__', field: '*', agg: 'count' }] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a measure id containing the cell-key separator', () => {
    const result = parseReportSpec(specFor({ measures: [{ id: 'a::b', field: '*', agg: 'count' }] }));
    expect(result.ok).toBe(false);
  });

  it('rejects an over-long filter value', () => {
    const result = parseReportSpec(
      specFor({ filters: [{ field: 'stage', op: 'eq', values: ['x'.repeat(10_000)] }] }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a non-hex colour override', () => {
    const result = parseReportSpec(
      specFor({
        chart: {
          type: 'bar',
          encoding: { measures: ['m1'], colorOverrides: { m1: 'red; background:url(x)' } },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });
});

// ── The guardrail ────────────────────────────────────────────────────────────

describe('guardrail: sql.raw is not used in the SQL layer', () => {
  it('finds zero occurrences of sql.raw under src/sql', () => {
    const offenders = sqlLayerSources().filter((f) => /\bsql\s*\.\s*raw\b/.test(codeOf(f)));
    // sql.raw interpolates a string into query text verbatim. It is the one call
    // that could undo everything the rest of this suite asserts, so the correct
    // count is zero — not "zero except for a good reason". If a future change
    // genuinely needs it, that is a design conversation, not a test edit.
    expect(offenders).toEqual([]);
  });

  it('finds no UNTAGGED template literal containing SQL keywords', () => {
    // A backtick string holding SELECT/FROM/WHERE that is NOT preceded by the
    // `sql` tag is someone assembling a query as text instead of as a fragment.
    const offenders = sqlLayerSources().filter((f) =>
      /(?<!\bsql)`[^`]*\b(SELECT|FROM|WHERE|GROUP BY)\b[^`]*`/.test(codeOf(f)),
    );
    expect(offenders).toEqual([]);
  });
});

function sqlLayerSources(): string[] {
  return walk(join(__dirname, '..', 'sql')).filter((f) => f.endsWith('.ts'));
}

/**
 * File contents with comments removed.
 *
 * Both guardrails scan for patterns that this package's own comments discuss at
 * length — the sql.raw prohibition is documented in four files. Scanning raw text
 * made the guardrail fire on its own documentation, which is the failure mode
 * that gets a security test deleted rather than fixed.
 *
 * This is a deliberately naive stripper: it does not understand a `//` inside a
 * string literal. That is acceptable here because a false NEGATIVE would require
 * an offender to hide `sql.raw` inside a string, and a string containing
 * "sql.raw" is not a call to it.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function describePayload(payload: string): string {
  const shown = payload.length > 24 ? `${payload.slice(0, 24)}… (${payload.length} chars)` : payload;
  return JSON.stringify(shown);
}
