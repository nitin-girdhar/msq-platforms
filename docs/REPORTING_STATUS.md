# Reporting & Charting — Implementation Status

Living status doc for the generic reporting platform. **Update this at the end of
every working session** so the next one can start cold.

- Approved plan: `C:\Users\ni3gi\.claude\plans\lets-review-the-plan-mutable-lightning.md`
- **Copy-paste prompts, one per phase: [`docs/REPORTING_PHASE_PROMPTS.md`](./REPORTING_PHASE_PROMPTS.md)**
  — each is self-contained for a cold session. Start at Phase 2.
- Last updated: **2026-07-30**
- Current position: **Phases 0 and 2 complete. Phase 1 code complete and validated
  against a live database. Phase 3 is next — read "Finding 5" first, it blocks the
  scatter chart type.**

> ### ✅ Resolved — the per-product role removal is complete
> The separate change **removing the per-product role model** has landed:
> `lms/hr/task.roles` + `.member_roles`, their resolvers, views and drizzle schemas
> are deleted; `db_scripts/15_drop_per_product_roles.sql` tears them down on existing
> databases; the three `TENANT_LOOKUP_TARGETS` gateway entries, the three
> `/lookups/{lms,hr,task}-roles` service modules and the three `lookup-admin` cards
> are gone.
>
> Both red checks previously noted here are now green:
>
> 1. **`pnpm typecheck`** — 56/56 tasks pass (the `taskRolesTable` error is fixed;
>    the tasks-service `task-roles` module that imported it was deleted).
> 2. **The leads-service drift test** — passes; the `lms-roles` router is deleted, so
>    it matches the gateway. No `EXEMPT` entry was needed.
>
> Two unrelated pre-existing failures remain (both reproduce on a clean tree, neither
> from reporting or the role removal): `@crm/hr-service` gateway-route-coverage flags
> two missing attendance-regularization gateway routes, and `@task/web-app` `lint`
> has no ESLint config so `next lint` prompts interactively and exits 1.

---

## What this is

A config-driven report builder: pick a dataset, drag fields onto Rows / Columns /
Values, choose an aggregation, pick a chart type. Domain-free, so LMS, HRMS and
Tasks all onboard by adding *metadata* rather than code. Plus report
subscriptions, emailed on a schedule.

The engine is `@platform/reporting` (`msq-core/packages/reporting`). Each product
service registers its own dataset registry and runs queries under its own
product-scoped PG login.

### The one rule to preserve

**Every identifier, operator and keyword in a generated query comes from a `SQL`
fragment authored in source. Every value from a request is a bound parameter.**
`sql.raw` is used nowhere in `src/sql` and a test enforces that. If a change seems
to need it, that is a design conversation, not a test edit.

---

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | `@platform/reporting`: spec contract, zod validation, SQL compiler, tests | ✅ **Done, verified** |
| 1 | LMS query endpoint (dataset + 5-file resource + gateway + drift test) | 🟢 **Code complete, DB-validated** |
| 2 | ui-kit chart primitives (Recharts, palette from `dataviz` skill) | ✅ **Done, verified** |
| 3 | LMS report builder page — **the end-to-end proof** | ⬜ Not started |
| 4 | Persistence: `report` schema + saved-report CRUD | ⬜ Not started |
| 5 | LMS dataset breadth — **the real test of the config-driven claim** | ⬜ Not started |
| 6 | HRMS onboards (registry-only, in principle) | ⬜ Not started |
| 7 | Subscription schema + scheduler, no UI | ⬜ Not started |
| 8 | Subscription UI + self-service | ⬜ Not started |
| 9 | HRMS subscriptions | ⬜ Not started |
| 10 | Dashboards, attachments, chart PNGs, tasks datasets | ⬜ Later |

---

## Phase 0 — DONE ✅

`msq-core/packages/reporting` (`@platform/reporting`). Two entry points:
`.` (browser-safe: spec, zod, pivot) and `./sql` (server-only: compiler).

**Verification at time of completion**

| Check | Result |
|---|---|
| Package tests | 257 passing, 6 files |
| Package typecheck (incl. tests) | clean |
| Package build | clean; `dist` has no test/fixture files |
| Repo-wide `pnpm typecheck` | 55/55 tasks successful |
| `pnpm depcruise` | no violations (543 modules, 1148 deps) |
| Entry-point import trace | `.` → `zod` only · `./sql` → `drizzle-orm`, `@platform/rbac` |

**Files** — `src/spec/` (limits, types, result, dataset-meta, schema, defaults,
pivot) · `src/sql/` (errors, dataset, aggregate, buckets, filters, scope,
registry, build, execute) · `src/__tests__/` (build, injection, pivot, registry,
execute, boundary + fixtures).

### Three findings from Phase 0 worth remembering

1. **`Intl.supportedValuesOf('timeZone')` is not a usable allowlist.** On this
   Node 22 build it returns the legacy alias `Asia/Calcutta` and **omits**
   `Asia/Kolkata` — the literal default on `entity.organizations.timezone`. It
   would have rejected every org's timezone. Validation is now by constructing a
   `DateTimeFormat`.
2. **Unchecked `Record` lookups were a hole.** `SORT_DIR[dir]` returned
   `undefined` for a bogus direction and drizzle interpolated it. Fixed with
   `requireKey()`, applied to every Record lookup not already gated by an
   `includes()` check against the dataset. Needed because a spec read back from
   `report_definitions.spec` JSONB has different provenance than a request body.
3. **The cell-cap threat is sparsity, not size.** Long rows are a subset of
   (groups × series), so a diagonal result at the group cap pivots to 25M cells.
   `countCells()` now runs *before* `pivotRows`, or the check would OOM rather
   than return a 400.

### Deviations from the approved plan

- `LIMITS` lives in `spec/limits.ts`, not `sql/caps.ts` — the zod schema and the
  UI's drop-zone gating both need it and neither may import the server-only entry.
- Capability keys moved from Phase 3 → Phase 1: the router needs them the moment
  it exists.
- ~~`GROUP BY`/`ORDER BY` re-emit the expression instead of using ordinals.~~
  **REVERTED in Phase 1 — the plan was right.** See finding 4 below.

---

## Phase 1 — CODE COMPLETE 🟢

Goal: correctly-scoped aggregated rows from the API. No UI.

### Finding 4 — the bug a real database found that 279 unit tests missed

**Every time-series report was broken.** Re-emitting a bucketed date expression in
`GROUP BY` produced:

```sql
SELECT   date_trunc('month', created_at AT TIME ZONE $1) AS d0
GROUP BY date_trunc('month', created_at AT TIME ZONE $6)
```

Drizzle emits a **fresh placeholder every time a value is interpolated**, so one
timezone became `$1`, `$6`, `$7`. Postgres compares `GROUP BY` to `SELECT`
*syntactically*, so it rejected the query:
`column "created_at" must appear in the GROUP BY clause`.

That is leads-over-time and attendance-over-months — the most important thing this
engine does. Asserting on generated SQL text could never catch it, because the text
looks correct. **Only a real database catches this class of bug.**

Fixed by reverting to the approved plan's ordinals: `GROUP BY 1, 2` / `ORDER BY 3 DESC`,
so a parameter-carrying expression is emitted exactly once. A dimension's declared
`sortExpr` is still re-emitted — safe, because a sortExpr is a parameter-free column
reference. Regression tests pin both the single-bind property and the ordinal form.

**Lesson for later phases: unit tests on generated SQL are necessary and not
sufficient. PREPARE every dataset's queries against a live database.** The harness
for that is described below and takes about a minute.

### Done

- **Capability seed** — `db_scripts/07_seed_lookup_data.sql`
  - Added `lms.reports` (page, sort_order 10) + `lms.reports.view` / `.manage` /
    `.share` operations.
  - Granted in full to `org_admin` and `tenant_admin`.
  - **`read_only`** granted `lms.reports` + `lms.reports.view`, and removed from
    the deny list. This role already existed for exactly this ("Read-only viewer
    — dashboards and reports only", rank 0) and is read-only *at the database*
    because it holds no `platform.write`. Deliberately **not** `.manage`/`.share`:
    saving INSERTs into `report.report_definitions`, which `readonly_user` +
    `transaction_read_only` refuses — a Save button that could only ever error.
  - **Managers and above** get view via a back-fill block pinned to
    `lms.campaigns.view` (the discriminator that means "manager and above" in this
    seed). Pinning rather than listing role names is what carries the grant onto
    the **per-tenant** ladder copies created by `_migrations/19` — a grant that
    only names global roles silently never reaches the roles it was built for.
  - `sales_representative` and `senior_sales_executive` remain denied.
- **`msq-core/packages/rbac/src/capabilities.ts`** hand-synced: `LMS_REPORTS`,
  `LMS_REPORTS_VIEW`, `LMS_REPORTS_MANAGE`, `LMS_REPORTS_SHARE`; Pages count
  comment 15 → 16.
- **Dataset** — `msq-lms/services/leads-service/src/api/v1/reports/datasets/leads.dataset.ts`,
  over `lms.vw_dashboard_leads`. ~20 dimensions, `requiresDateRange` on
  `created_at` (90-day default), scoped on `org_id` / `assigned_user_id`, row
  scoping via `CAPABILITY.LMS_LEADS_VIEW`.

- **Service resource** — `msq-lms/services/leads-service/src/api/v1/reports/`:
  `reports.{router,controller,service,repository,schema}.ts` + `datasets/`.
  Registered in `src/api/v1/index.ts`. `@platform/reporting` added to package.json.
  - Routes: `GET /analytics/reports/datasets`, `GET …/datasets/:key`,
    `POST …/query` — all behind `authenticate` + `requireModule('lms')` +
    `requireCapability(LMS_REPORTS_VIEW)`.
  - `runReport` wraps everything in `withRoleTx({ …, readOnly: true })` with the
    real actor. Timezone read from `entity.organizations.timezone` via `withServiceTx`.
- **Gateway** — 3 `proxyTo` registrations in `api-gateway/src/server.ts` (~line 615).
  No change needed to `product-map.ts`: `/analytics/*` already resolves to `lms`.
- **vitest added to leads-service** (it had no `test` script — anything written
  there previously ran nowhere), plus `tsconfig.typecheck.json` so tests are
  typechecked. Note `hr-service` excludes its tests from tsc entirely, which is why
  its `import.meta` usage compiles; leads-service is CommonJS so its test uses
  `__dirname`.
- **Drift test** — `src/api/v1/__tests__/gateway-route-coverage.test.ts`, adapted
  from the hr original (LMS paths are not namespaced, so `toGatewayPath` is
  identity; `/internal/*` exempt by prefix).
- **Dataset test** — `src/api/v1/reports/__tests__/leads-dataset.test.ts`, 20 tests
  incl. "the three scopes produce genuinely different SQL", which is the assertion
  scheduled email will depend on in Phase 7.

### Verification actually performed

| Check | Result |
|---|---|
| `@platform/reporting` tests | **259 passing** |
| `@crm/leads-service` tests | 21 passing, **1 failing — the in-flight role refactor above** |
| Both packages typecheck (incl. tests) + build | clean |
| Repo-wide `pnpm typecheck` | 51/56 — the 5 failures are the in-flight role refactor, not reporting |
| `pnpm depcruise` | no violations |
| **Capability seed vs live schema** | validated in a **rolled-back** transaction: 0 grants pruned by an ungranted ancestor; effective access exactly as intended |
| **All 25 generated queries PREPAREd on live Postgres** | **25/25, zero errors** |

### Still outstanding for Phase 1

- [ ] **Manual RLS proof** — the capability-scope predicates are unit-tested and the
      SQL is DB-validated, but rows have not been diffed for three real actors
      against seeded data. Do this before Phase 4.
- [ ] End-to-end `curl` through the running gateway (needs a session cookie; the
      compiled SQL and the capability matrix are both already validated directly).

### How the DB validation was done (repeat this per dataset)

1. Write a throwaway `emit-sql.ts` in the service root (outside `src`, so tsc
   ignores it) that imports the dataset, loops **every** dimension and measure,
   calls `buildReportQuery`, and prints `PREPARE p<i> AS <sql>; DEALLOCATE p<i>;`.
2. `pnpm --filter @platform/reporting build` **first** — the service consumes `dist`,
   so an un-rebuilt engine validates stale code. This bit me once.
3. `npx tsx emit-sql.ts > prepared.sql`
4. `docker cp prepared.sql msq-db-server:/tmp/` then
   `docker exec msq-db-server psql -U postgres -d platforms -f /tmp/prepared.sql`
5. Delete the throwaway script.

`PREPARE` parses, rewrites and plans without executing, so it validates every column
name and type against the real relation. **Use PowerShell, not Git Bash** — bash
mangles `/tmp/x.sql` into a Windows path, psql then reports "No such file", and the
run silently looks clean.

---

## Phase 2 — DONE ✅

`msq-core/packages/ui/src/components/Chart/` (`@platform/ui-kit`). Domain-free
Recharts primitives over a `ReportResult`. No builder UI, no data fetching, no LMS
knowledge.

### Finding 5 — **no valid `scatter` spec can exist today.** Blocks Phase 3.

`CHART_SHAPE_RULES.scatter` in `spec/types.ts:231` sets `maxMeasures: 1` *and*
`requiresXMeasure: true`, and `reportSpecSchema` (`spec/schema.ts:222`) separately
requires `chart.encoding.xMeasure` to name a measure that exists in
`spec.measures`. A scatter therefore needs two measures — one for x, one for y —
while being capped at one. Every scatter spec fails validation, whichever way it is
written. Nothing caught it because Phase 0's tests exercise the shape rules and the
referential-integrity check independently, never the pair.

**Fix is one character: `maxMeasures: 2` on the scatter rule**, plus a test that
builds an actually-valid scatter spec end-to-end. Deliberately NOT done here —
Phase 2's brief is ui-kit only, and this changes the reporting package's validation
contract, which is a spec decision with its own test surface. **Do it before Phase 3
wires the ChartTypePicker**, or the picker will offer a type that can never run.

`ReportChart` already behaves correctly either way: when `xMeasure` resolves it
draws the scatter (proved visually with a hand-built two-measure result), and when
it does not it renders an explicit message rather than an empty plot with an
invisible axis.

### Finding 6 — ui-kit uses bundler resolution, not NodeNext

Relative imports inside `packages/ui/src` must be **extensionless**
(`./format`), not `./format.js`. `packages/ui/tsconfig.json` sets
`moduleResolution: "bundler"`, unlike `@platform/reporting`'s NodeNext. Writing
the reporting package's `.js` convention here **typechecks clean** — tsc resolves
it — and then fails only at Next build time with `Module not found: Can't resolve
'./ReportChart.js'`. `pnpm --filter @platform/ui-kit typecheck` cannot catch this.
Anything new in ui-kit needs a real Next compile before it is called done.

### The palette (`Chart/palette.ts`)

Procedure followed exactly: the `dataviz` skill's `references/palette.md` values
were the starting point, `scripts/validate_palette.js` was run against **this
platform's** surfaces (light `#ffffff` — the card a chart sits on; dark `#0F172A`),
and only then was one hue nudged toward the platform accent, with a re-validation
after. No hex was eyeballed and none was sampled out of a Tailwind class string.

**The one deviation from the reference values:** categorical slot 1 in light mode
moved from `#2a78d6` (blue ramp step 450) to `#256abf` (step 500) — the documented
step nearest the platform's existing accent `#0b6cbf` (Button, MultiSelect,
UserPicker, MonthGrid). Hue family held, lightness moved one documented step, whole
set re-validated. No other slot moved; the dark column is unchanged.

| Check | Light (`#ffffff`) | Dark (`#0F172A`) |
|---|---|---|
| Lightness band / chroma floor | PASS | PASS |
| CVD separation (adjacent) | PASS ΔE 9.1 | PASS ΔE 8.4 |
| Normal-vision floor (adjacent) | PASS ΔE 19.6 | PASS ΔE 19.3 |
| Contrast vs surface | **WARN** — 3 slots < 3:1 | PASS all ≥ 3:1 |
| `--pairs all`, first 3 slots | PASS ΔE 9.2 | PASS ΔE 9.4 |
| sequential + both diverging arms, `--ordinal` | PASS | PASS |

**The contrast WARN is not dismissable and has a mandatory mitigation.** Aqua
(2.82), yellow (2.17) and magenta (2.69) sit below 3:1 on white, which obligates a
relief channel. Ours is **ChartFrame's built-in Chart/Table toggle**, present on
every chart form except `table` (already one) and `kpi` (already text), plus the
legend that is always rendered at ≥2 series. Removing either re-opens the failure —
`palette.ts` says so at the top of the file.

Two consequences encoded in code, not just prose:
- `SCATTER_SERIES_CAP = 3`. Scatter/bubble need all-pairs separation, and no
  ordering of eight hues clears it; `ReportChart` slices scatter series to three.
- `CATEGORICAL_SLOTS = 8`, never cycled into a generated hue. `exceedsSlots()`
  drives a visible ChartFrame banner when a result would need more.

### Files

`ReportChart.tsx` `ChartFrame.tsx` `ChartTooltip.tsx` `ChartLegend.tsx`
`Sparkline.tsx` `KpiTile.tsx` `KpiRow.tsx` `DataTable.tsx` `palette.ts` `format.ts`
`index.ts`, plus `__tests__/{chart.test.ts,fixtures.ts}`.

**Deviation from the plan's file list: one extra file, `series.ts`.** It resolves
`(spec, result) → what to draw, in what order, in what colour`, and ChartLegend,
ChartTooltip and DataTable all need it. The alternative was exporting it from
`ReportChart.tsx`, which would drag Recharts into every module that wants a colour.

`ReportChart` takes the planned props (`spec, result, loading, error, height,
palette, onPointClick, emptyMessage`) **plus `mode?: 'light' | 'dark'`, `title`,
`subtitle`, `className`**. `mode` defaults to `'light'` and does **not** sniff
`prefers-color-scheme`: `lms-web/app/globals.css` hard-codes a light background, so
auto-detection would put a dark chart on a light page. Dark tokens exist and are
validated so the platform's eventual dark mode is a prop flip, not a repaint.

### Invariants worth not breaking

- **A null cell is a gap.** `toPlotValue` returns `null`, never 0; `connectNulls`
  is false on every line and area; a null pie slice is dropped rather than drawn at
  zero; `formatMeasure(null)` is `—`. Unit-tested, and visually confirmed (a
  deliberate March hole broke the line, the area and the stacked bar).
- **`meta.truncated` gets a banner above the plot**, not a footnote.
- **Colour follows the entity, never its rank.** Slot assignment uses the position
  in the full `spec.measures × result.series` cross product, so hiding a measure in
  `encoding.measures` does not repaint the survivors. Pinned by a test.
- **`colorOverrides` is untrusted text.** It reaches a `fill=` attribute, and in
  Phase 7 an inline style in an email. Only a literal hex passes `isChartColor`;
  a test feeds it `url(javascript:…)`, `expression(…)` and friends.
- **`@platform/ui-kit` imports `@platform/reporting`'s `.` entry only.** A test in
  `chart.test.ts` scans the folder for any `@platform/reporting/<subpath>` import,
  and a second one scans for domain knowledge (`/api/v1/`, `lms.`, `CAPABILITY.`).

### Recharts

`recharts@3.10.1` in ui-kit **`dependencies`**, not peer. **No React peer warning on
install** — recharts peers `react ^19`, `react-dom ^19` and `react-is ^16.8`; pnpm
resolved react/react-dom 19.2.7 and linked `react-is@16.13.1` into the recharts
virtual store dir. `lms-web` does **not** list recharts and must not — that is the
only path to two Reacts. AG Grid was not added; `DataTable.tsx` is a plain semantic
`<table>`.

Recharts 3's types are stricter than v2's and fight `exactOptionalPropertyTypes`.
Two adaptations: tooltip payloads are normalised through `toTooltipEntries` (its
`dataKey` can be an accessor function), and **line/area click is chart-level, not
per-mark** — a continuous path has no single datum under the cursor, so Recharts
reports the DOM event. Consequence: `onPointClick` on line/area gives the row and
category but leaves `series` undefined. Bar, pie and scatter report the series.

### Verification actually performed

| Check | Result |
|---|---|
| `pnpm --filter @platform/ui-kit typecheck` | clean |
| `pnpm --filter @platform/ui-kit test` | **45 passing** (24 new) |
| `pnpm --filter @platform/reporting test` | **259 passing**, boundary tests green |
| `pnpm depcruise` | no violations (555 modules, 1174 deps — was 543/1148) |
| Repo-wide `pnpm typecheck` | **56/56 successful** |
| `dataviz` contrast validator | run per mode, per pairlist, per ramp — table above |
| **Visual proof, light + dark** | every ChartType rendered from a hardcoded `ReportResult`, screenshotted |

The visual proof was a throwaway `app/chart-proof/page.tsx` in lms-web (outside
`/dashboard`, so the auth middleware did not gate it), rendering all ten chart types
plus the truncated / loading / error / empty states and both KPI tiles, in both
modes. **Deleted afterwards** — including the stale `.next/types/app/chart-proof/`
tsc picks up, which fails `pnpm typecheck` if left behind.

Note for next time: a folder named `__chart-proof` returns 404 — Next's App Router
treats a leading-underscore folder as private and excludes it from routing.

### What Phase 3 must know

1. **Fix Finding 5 first** (`maxMeasures: 2` on the scatter shape rule), or the
   ChartTypePicker offers a chart that can never validate.
2. `ReportChart` is fully controlled and holds no fetching. It renders its own
   loading / error / empty / truncated states, so `ReportsClient` should pass SWR's
   state straight through rather than branching around it.
3. It expects `result.spec` to be the spec **as executed**. Passing the
   locally-edited spec while showing an older result mislabels the chart.
4. Series colour is stable only if `result.series` order is stable. A dimension
   whose `sortExpr` is missing (see the stage/pipeline-order follow-up below) will
   reorder between runs and repaint the chart.
5. The Chart/Table toggle is an accessibility obligation, not a nicety — see the
   contrast WARN above before styling it away.

---

## Known follow-ups, parked deliberately

- **Stages sort alphabetically, not in pipeline order.** `lms.vw_dashboard_leads`
  exposes `ls.name`/`ls.label` but **not** `ls.sort_order`, so the `stage` dimension
  has no `sortExpr` and a pipeline chart renders "Contacting, Converted, New,
  Qualified" instead of pipeline order. Fix is one appended column in the view
  (`ls.sort_order AS stage_sort` in `db_scripts/02_schema.sql`) plus
  `sortExpr: sql\`stage_sort\`` on the dimension. Not done here because appending a
  column to a shared view affects any `SELECT *` consumer and deserves its own change.
- **Two pre-existing gateway gaps found by the new drift test**, recorded as
  documented `EXEMPT` entries rather than silently widened:
  `/campaigns/platforms` and `/campaigns/statuses` are only *incidentally* reachable
  — they fall through the gateway's `/campaigns/:id` route, which happens to rebuild
  the right upstream path. Same capability gate, so no security gap, but it breaks
  the moment that route gains uuid validation.
- **`hr-service`'s own drift test is failing, pre-existing and unrelated**:
  the gateway has no `PATCH /hr/attendance/regularizations/:id` or
  `POST …/:id/cancel`, yet `hr-web` calls the latter. Verified against `HEAD` — not
  caused by this work. Regularization edit/cancel is a hard 404 today.

- **`hr_svc` lacks `GRANT SELECT ON iam.vw_user_team_members`.** `lms_svc` has it
  (`db_scripts/04_roles_and_grants.sql:597`). Phase 6 needs that grant before any
  HR dataset can serve a `team`-scoped actor.
- **`marketing.vw_tenant_campaign_summary` is not granted to `lms_svc`** — needed
  by the campaigns dataset in Phase 5.
- **`capabilities.ts` is marked generated but has no generator.** Keys are
  hand-synced with the seed. Writing `scripts/gen-capabilities.ts` would close the
  drift risk permanently.
- **`pnpm lint` fails in `@auth/web`** — pre-existing and unrelated: `next lint`
  there has no ESLint config and prompts interactively. Not caused by this work.
- **No numeric fact on leads.** `vw_dashboard_leads` has no deal value, so the
  leads dataset exposes only count/count-distinct. Sum/avg measures need a value
  column first.
- **Tenant-wide leads reporting is rejected** — the view exposes no `tenant_id`.
  Add the column to the view before enabling it.

---

## How to verify (any phase)

```bash
# from c:\Girdhar\MSquare\repos\msq-platforms
pnpm --filter @platform/reporting test        # engine unit tests
pnpm --filter @platform/reporting typecheck   # includes the test files
pnpm typecheck                                # repo-wide, all packages
pnpm depcruise                                # package boundary rules
make dev-infra                                # Postgres in Docker
```

Ports: gateway **4000**, auth-web 3000, lms-web 3001, hr-web 3002, lookup-admin 3005.
DDL: `db_scripts/db_deploy.ps1`. psql: `make db-shell`.

**Note:** `pnpm dev`'s `predev` runs `pnpm stop` = `taskkill /F /IM node.exe`,
which kills every node process on the machine.
