# Platform Refactor — Prompt Runbook (with model assignments)

> **Companion to:** `docs/Platform_Implementation_Plan.md` and `docs/Platform_Architecture_Decisions.md`.
> **How to use:** run each prompt as a separate Claude Code task, in order, respecting the dependency notes. Switch model with `/model <name>` before running. Each prompt lists the recommended model and why.

## Model legend

| Model | Use for | Why |
|---|---|---|
| **Opus** (`claude-opus-4-8`) | Design judgment, security/auth changes, ambiguous cross-cutting refactors, DB modeling | Highest reasoning; auth mistakes are expensive |
| **Sonnet** (`claude-sonnet-5`) | Well-specified implementation of moderate complexity — package moves, migrations to a known recipe, route moves | Fast, strong at spec-driven code |
| **Haiku** (`claude-haiku-4-5`) | Rote, low-risk — import find/replace, doc/Bruno updates, seed fixtures | Cheapest; near-zero judgment needed |

> Rule of thumb: **Opus decides the shape, Sonnet builds it, Haiku sweeps up.** When unsure, one level up.

---

## Phase 0 — Boundary cleanup

### P0.1 — Split the permissions package *(Opus)*
> Split `packages/permissions` into four packages per `docs/Phase0_Scope.md` PR-A: `@platform/authz`, `@lms/authz`, `@hr/authz`, `@task/authz` (the lead product is **LMS**, so its package is `@lms/authz`, not `@crm/authz`). Move files exactly per the mapping table, keep every function signature identical, and add a `@crm/permissions` compatibility barrel that re-exports from the four new packages so existing imports keep working. Keep the shared numeric rank scale in `@platform/authz` for now. `pnpm typecheck` must stay green.
- **Why Opus:** package boundary design + the rank-ladder-during-transition decision needs judgment; getting the seams right here shapes everything downstream.
- **Depends on:** nothing.

### P0.2 — Migrate imports off the shim *(Haiku)*
> Replace all `@crm/permissions` imports across services/apps with the correct new package (`@platform/authz`/`@lms/authz`/`@hr/authz`/`@task/authz`) per what each site actually uses, then delete the `@crm/permissions` compatibility barrel. Verify `pnpm typecheck`.
- **Why Haiku:** mechanical find/replace against a known mapping; ~81 files but no judgment.
- **Depends on:** P0.1.

### P0.3 — Dependency-cruiser wall *(Sonnet)*
> Add `.dependency-cruiser.cjs` with the forbidden-rule set from Phase0_Scope.md PR-B (platform ✗→ product; each product ✗→ sibling product), a `depcruise` root script, and wire it into the turbo lint pipeline. Prove it fails on a deliberate cross-product import, then revert the test import.
- **Why Sonnet:** well-specified config + verification, low ambiguity.
- **Depends on:** P0.1.

### P0.4 — Gateway entitlement enforcement *(Opus)*
> Implement Phase0_Scope.md PR-C: add tenant RLS to `entity.tenant_modules`; add a route-prefix→product map at the gateway that rejects calls to unlicensed products after JWT verify (close the ungated LMS/leads gap); keep per-service `require-module` as defense-in-depth; rename the lead product's entitlement key `'crm'`→`'lms'` (module CHECK constraint + existing rows) and backfill every existing tenant with an active `lms` row (+ hr/task where used); point `@platform/authz.hasProduct()` at the table with a cached read. Update `/api-testing/` Bruno files.
- **Why Opus:** central authorization choke point — a mistake here 403s real traffic or leaks access; RLS + backfill correctness matters.
- **Depends on:** P0.1.

---

## Phase 1 — Authorization decoupling *(highest value; do before any new product)*

### P1.0 — crm-naming cleanup pass: schema `crm`→`lms` + role `crm_service`→`root_service` *(Sonnet)*
> Two mechanical renames done together (they hit the same `db_scripts`/env files).
>
> **(a) Schema `crm` → `lms`** — so the product name (LMS) matches the schema. Steps: (1) a one-time migration `db_scripts/15_rename_crm_to_lms.sql` that runs `ALTER SCHEMA crm RENAME TO lms;` guarded by an existence check, then `CREATE OR REPLACE` for the ~8 trigger/functions whose bodies hardcode `crm.` (`log_lead_stage_change`, `log_lead_assignment`, `check_follow_up_completion`, `sync_follow_up_status`, `set_default_follow_up_status`, the `*_fk_org_scope` checks, `check_lead_stage_outcome`) — update every `crm.` literal in their bodies to `lms.`; (2) find/replace `crm.`→`lms.` and `pgSchema('crm')`→`pgSchema('lms')` in `db_scripts/*.sql` so fresh installs create `lms` directly (keep the migration idempotent/guarded so a fresh install + the migration don't conflict); (3) Drizzle: rename `crmSchema`→`lmsSchema` in `packages/db/src/schema/pg-schemas.ts` and update the 16 table files; (4) the ~57 raw-SQL `crm.` references across leads-service, meta-conversion-api, notifications, identity-service, and `@crm/db`; (5) Bruno tests + `Architecture.md`/`DB_model.md`. **Do NOT touch** the `marketing`/`ext` schemas (LMS sub-domains — keep their names).
>
> **(b) Platform role `crm_service` → `root_service`** — the BYPASSRLS service role is platform-owned and misnamed "crm". In the same migration: `ALTER ROLE crm_service RENAME TO root_service;` (grants + `TO crm_service` RLS policies follow the OID automatically). Update the literals: `CREATE ROLE`/`GRANT`/policy `TO` clauses in `db_scripts`, `DATABASE_URL_SERVICE` in `.env.example` + `docker-compose*.yml` + per-service `.env.example`, `APP_ROLE_TO_PG_ROLE` in `packages/auth-constants/src/roles.ts`, and the `serviceDb()` pool config in `@crm/db`. ~110 refs total. It is **BYPASSRLS, not a superuser** — do not grant it `SUPERUSER`.
>
> **Verify:** apply against a fresh dev DB, then run the existing RLS + trigger smoke tests (lead stage-change logging, follow-up completion) and confirm a `serviceDb()`/`withServiceTx` path still connects and bypasses RLS. `pnpm -r build` green.
- **Why Sonnet:** mechanical + recipe-driven; `ALTER SCHEMA RENAME` and `ALTER ROLE RENAME` move tables/views/RLS/grants/policies wholesale, so the only care-areas are the ~8 function bodies and the env/connection literals — all well-enumerated.
- **Depends on:** Phase 0. Do this **first in Phase 1** so P1.1's new tables land in the `lms` schema and Drizzle files are touched once.
- **Note:** run `/security-review` after — RLS policies move with the schema and must be re-verified.

### P1.1 — Design per-product role model *(Opus)*
> Design (SQL + Drizzle + migration) the per-product role tables `lms.member_roles`, `hr.member_roles`, `task.member_roles` (tenant-scoped, RLS, own rank), the `(user, product, role)` grant model, and the shrunk JWT shape (`identity + platform_role + tenant/org + licensed_products`, no global role/rank). Produce a migration + backfill plan that maps today's `iam.user_roles` ladder onto the new per-product tables without downtime. Do not implement yet — output the model, migration order, and rollback.
- **Why Opus:** core security/data-model decision; the migration-without-downtime plan is the crux.
- **Depends on:** P1.0.

### P1.2 — Implement role tables + grants + backfill *(Sonnet)*
> Implement the schema, migrations, and backfill from P1.1. Add per-product DB role GRANTs (D8): `lms_svc`/`hr_svc`/`task_svc` read/write only their schema + read shared `iam`/`entity`/`geo`; revoke cross-schema. Update seed scripts and Bruno tests.
- **Why Sonnet:** spec is fixed by P1.1; execution is recipe-driven.
- **Depends on:** P1.1.

### P1.3 — Shrink JWT + per-service role resolution *(Opus)*
> Change identity-service to issue the shrunk JWT (P1.1); update gateway header injection; make each product service resolve the user's *product* role from its own `member_roles` table instead of trusting a global rank header. Keep login UX unchanged. Update `@platform/authz`, `@lms/authz`, `@hr/authz` call sites and Bruno tests.
- **Why Opus:** touches token issuance + every service's authorization path; security-critical.
- **Depends on:** P1.2.

---

## Phase 2 — Hierarchy decoupling

### P2.1 — `hr.reporting_lines` model + repoint approvals *(Opus)*
> Design and implement effective-dated `hr.reporting_lines` (tenant/org scoped, RLS); repoint `services/hr-service/.../resolve-approvers.ts` to walk it instead of `iam.users.manager_id`; backfill current reporting lines from `manager_id`. Keep the pure `buildApproverChain` logic and its unit tests. Degrade `iam.users.manager_id` to an optional default.
- **Why Opus:** approval-chain correctness + data backfill; walking the wrong tree approves the wrong people.
- **Depends on:** Phase 1.

### P2.2 — Tests + docs for hierarchy split *(Sonnet)*
> Add unit/integration tests proving HR approval chains are independent of LMS assignment hierarchy; update Architecture/DB docs and Bruno files.
- **Why Sonnet:** spec fixed by P2.1.
- **Depends on:** P2.1.

---

## Phase 3 — Tenant-scoped configuration & seeding (parallel to Phase 2)

### P3.1 — Convert global lookups to tenant-scoped *(Sonnet)*
> Add `tenant_id NOT NULL` + `tenant_isolation_policy` to every currently-global lookup (`task_statuses`, `task_priorities`, HR `leave_types`/`employment_types`/`attendance_statuses`, and the new role tables). Migrate existing global rows to per-tenant copies. Update Drizzle + Bruno.
- **Why Sonnet:** repetitive recipe application across many tables.
- **Depends on:** Phase 0 (P1 for role tables).

### P3.2 — Tenant default seeding *(Opus)*
> Design + implement `seedTenantDefaults(tenantId)` run at tenant provisioning, with versioned default catalogs (JSON/SQL fixtures per product), inserting a private copy per licensed product. Ensure editing a catalog never retroactively touches existing tenants; add an explicit opt-in "reset to defaults" path.
- **Why Opus:** provisioning correctness + the "no retroactive change" invariant needs care.
- **Depends on:** P3.1.

### P3.3 — Tenant-context lookup-admin *(Sonnet)*
> Make `apps/lookup-admin` act within a selected tenant's context (set `app.current_tenant_id`) instead of editing global rows; add tenant selection for super_admin.
- **Why Sonnet:** UI + context plumbing, well-specified.
- **Depends on:** P3.1.

---

## Phase 4 — Web product split

### P4.1 — Extract `@platform/ui-kit` *(Opus)*
> Extract the design system, session hooks, and API client from `apps/web` into `@platform/ui-kit`; leave `apps/web` consuming it with no visual change.
- **Why Opus:** picking the right shared-vs-product boundary in the UI layer is a judgment call that all product UIs inherit.
- **Depends on:** Phase 0.

### P4.2 — Product route-groups + feature packages *(Sonnet)*
> Reorganize `apps/web` into `(lms)`/`(hr)`/`(todo)` route groups backed by `@lms/web`/`@hr/web`/`@task/web` feature packages; add a product switcher driven by `licensed_products`.
- **Why Sonnet:** move + reorganize to a clear target.
- **Depends on:** P4.1 (best after P1.3 for licensed_products).

### P4.3 — Split into per-product Next apps/images *(Opus)*
> Split the route groups into separate Next apps (`lms-web`, `hr-web`, `todo-web`), each its own image, sharing one SSO cookie on `.app.com`, with login at `auth.app.com`. Verify no re-login when switching products.
- **Why Opus:** SSO cookie/domain + multi-app session sharing has sharp edges.
- **Depends on:** P4.2.

---

## Phase 5 — Repo extraction + local Docker delivery

### P5.1 — Parent workspace + repo extraction plan *(Opus)*
> Produce the exact `git filter-repo` path sets per target repo (`shared-repo`, `lms-repo`, `hrms-repo`, `todo-repo`), the parent `pnpm-workspace.yaml`, and the order of extraction. Include the **`db_scripts/` carve plan**: which script (or which part of a schema-mixed script like `01`, `10`, `01_init-lookup-data`) goes to which repo, per the ownership table + shared-first run order in "Cross-repo database handling" (D4, Architecture doc); and the split of Drizzle table types (shared → `@platform/db`, product → product repo). Flag any remaining cross-boundary imports that must be cleaned first.
- **Why Opus:** one-way-ish operation; the path partition + residual-coupling check needs judgment.
- **Depends on:** Phases 0–4.

### P5.2 — Self-contained Dockerfiles via `pnpm deploy` *(Sonnet)*
> Write per-service/app Dockerfiles that build from `pnpm --filter <pkg> deploy ./build/<pkg> --prod` output; add a `docker save | gzip` ship script and server-side `docker load` + run notes. Verify `pnpm deploy` flags against pnpm 9.15.
- **Why Sonnet:** well-defined build recipe.
- **Depends on:** P5.1.

### P5.3 — Execute the extraction *(Sonnet)*
> Run the extraction plan from P5.1 (or generate the scripts for the user to run), wire each repo to `@platform/*` via the workspace, and verify each product builds + typechecks standalone.
- **Why Sonnet:** mechanical execution of a fixed plan.
- **Depends on:** P5.1.

---

## Phase 6 — New product on the template

### P6.1 — Scaffold `gym-repo` on the clean template *(Opus)*
> Build a Gym membership product end-to-end on the template: `gym` schema (+ RLS, grants), `gym.member_roles`, reporting model if needed, gym-service, gym-web image, and a `tenant_products` entitlement — with **zero edits to LMS/HR/Task code**. Report any place the template forced a cross-product change (a seam leak to fix).
- **Why Opus:** greenfield product design + it's the acceptance test for the whole refactor.
- **Depends on:** Phase 5.

---

## Quick reference — model per phase

| Phase | Opus | Sonnet | Haiku |
|---|---|---|---|
| 0 | P0.1, P0.4 | P0.3 | P0.2 |
| 1 | P1.1, P1.3 | P1.0, P1.2 | — |
| 2 | P2.1 | P2.2 | — |
| 3 | P3.2 | P3.1, P3.3 | — |
| 4 | P4.1, P4.3 | P4.2 | — |
| 5 | P5.1 | P5.2, P5.3 | — |
| 6 | P6.1 | — | — |

**Security-sensitive prompts (run `/security-review` after):** P0.4, P1.1, P1.3, P2.1 (Opus); **P1.0** (Sonnet — RLS policies move with the schema rename and must be re-verified).
