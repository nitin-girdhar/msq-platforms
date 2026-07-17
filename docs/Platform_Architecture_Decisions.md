# Platform Architecture Decisions (ADR)

> **Status:** Accepted (2026-07-17)
> **Supersedes topology sections of** `Platform_Expansion_Plan.md` (which assumed a single monorepo).
> **Context:** Evolving the codebase from a single product into a multi-product platform (LMS, HRMS, To-Do/Tasks, future Gym Membership, Sales tooling). Products must be independently developable, deployable, and sellable under a subscription model, while sharing authentication, gateway, and core infrastructure.

---

## Decision summary

| # | Decision | Choice |
|---|---|---|
| D1 | Repo topology | **Multi-repo**: one `shared-repo` + one repo per product, cloned side-by-side |
| D2 | Web topology | **Separate UI image per product**, single SSO cookie on a shared parent domain |
| D3 | Authorization | **Per-product roles + per-product hierarchy**; identity-only `iam.users` |
| D4 | Database | **One shared Postgres cluster, schema-per-product** (NOT a DB per product) |
| D5 | Shared code | **Local pnpm workspace** for dev + image builds (`pnpm deploy` for self-contained images); git-tag deps when builds leave the laptop; registry later |
| D6 | Entitlements | `entity.tenant_products` enforced centrally at the **gateway** |
| D7 | Configuration & lookups | **Tenant-scoped with strict tenant RLS** — no global/shared lookup rows |
| D8 | Data storage & isolation | **Product-owned schemas + per-product DB grants; two isolation axes; no cross-product FKs/joins** |

---

## Product naming — "LMS", not "CRM"

The lead-management product is **LMS (Lead Management System)** — it is a lead pipeline, not a full CRM. Everywhere in these docs the lead product is called **`lms`**. Two distinct "crm" names in the current codebase must not be conflated:

| Today | Becomes | What it is |
|---|---|---|
| `@crm/*` packages (`@crm/db`, `@crm/types`, `@crm/permissions`, `@crm/ui`…) | `@platform/*` | **Platform** packages shared by every product — misnamed because the repo began as a CRM. Renamed as part of Phase 0. |
| the "crm" *product* (leads/marketing/meta domain) | `lms` | The **Lead Management System** product: `lms` schema (renamed from `crm` — see P1.0), `lms-repo`, `@lms/*` packages, `lms` entitlement key, `lms_svc` DB role, `(lms)` web route group. |
| `crm_service` DB role (BYPASSRLS, used by every service's `withServiceTx`) | `root_service` | The **platform** BYPASSRLS role — misnamed "crm". Renamed to `root_service` (`ALTER ROLE` + `DATABASE_URL_SERVICE` + `APP_ROLE_TO_PG_ROLE` + `db_scripts` literals). Note: it is BYPASSRLS, *not* a Postgres superuser. Done in the P1.0 rename pass. |

The `crm` → `lms` **database schema** rename is a real migration (`ALTER SCHEMA` + ~8 trigger-function body fixes + ~57 code refs + Drizzle) scheduled as **P1.0** (Phase 1). The `marketing` and `ext` schemas are LMS sub-domains and keep their names for now (renaming them is optional later).

---

## D1 — Multi-repo topology

```
<root>/
  shared-repo/     # the platform core — shared services + published packages + shared schemas
  lms-repo/        # LMS (Lead Management System) product — leads/marketing/meta
  hrms-repo/       # HRMS product (leave, attendance, employee profiles)
  todo-repo/       # To-Do / Tasks product
  gym-repo/        # future — Gym membership (built on the clean template)
  sales-repo/      # future
```

**Rationale:** parallel teams per product, independent release cadence, independent product lifecycle (ship/retire a product without touching others).

**What lives where**

`shared-repo` (deployed once for the whole platform):
- Services: `identity-service` (auth/users/orgs/tenants/SSO), `api-gateway` (JWT verify, header injection, route registry, entitlement gate), `notifications-service` / `communication-service`, `admin-service` (shared lookups) + `lookup-admin` UI.
- Owns migrations for shared schemas: `iam`, `entity`, `geo`, `audit`, plus `entity.tenant_products`.
- Publishes packages (private registry):
  - `@platform/db` — pool trio (`appDb`/`tenantDb`/`serviceDb`), `withRoleTx`/`withServiceTx`, RLS helpers, migration kit
  - `@platform/authz` — rank-free platform authorization (tenant/org/product-grant checks)
  - `@platform/types` — `SessionUser` core, JWT, tenancy types
  - `@platform/service-auth` — internal-secret + gateway-header trust
  - `@platform/service-kit` — Fastify bootstrap + auth-middleware template
  - `@platform/ui-kit` — design system, session + API-client hooks
  - `@platform/audit-log`

Each product repo (`lms-repo`, `hrms-repo`, ...):
- Its domain service (`leads-service`, `hr-service`, `tasks-service`).
- Its web app as **its own Docker image** (`lms-web`, `hr-web`, ...).
- Its own schema + migrations only (`lms.*` (+ `marketing`/`ext`), `hr.*`, `task.*`).
- Its own authz + hierarchy: `@lms/authz`, `@hr/authz` (roles, rank, reporting lines).
- Depends on `@platform/*`. **Never imports another product repo.**

---

## D2 — Web topology: separate images, one SSO session

- Each product UI is a **separate deployable image** → independent deploy, independent shutdown, per-product access.
- **Single sign-on:** `identity-service` issues the JWT; the `fc_session` cookie is set on the **parent domain** (`.yourapp.com`) so every product UI on a subdomain (`lms.yourapp.com`, `hr.yourapp.com`) is already authenticated — no re-login when switching tools.
- Each product web image checks `licensed_products` in the session and hides/blocks tools the tenant/user isn't entitled to. A **product switcher** in `@platform/ui-kit` shows only licensed products.
- Login/auth screens live once in `shared-repo` (or an `auth.yourapp.com` shell); products are thin UIs over the shared gateway.

---

## D3 — Per-product roles + per-product hierarchy

**Problem being fixed:** today a single global 0–100 rank (`packages/permissions/ranks.ts`) mixes sales roles, HR roles, and platform roles, and a single `iam.users.manager_id` chain is reused for both LMS lead assignment and HR leave approval. Authority for one product is derived from another product's rank.

**Target model:**
- `iam.users` = identity only (auth + profile). No product role.
- **Platform roles** shrink to account-level only: `super_admin`, `tenant_admin`, `org_admin`.
- Each product owns its **own role table + rank**: `lms.member_roles`, `hr.member_roles`, `gym.member_roles`. A user holds a **set of `(product, role)` grants**, not one global role.
- Each product owns its **own hierarchy**: HR reporting line = effective-dated `hr.reporting_lines` (leave approval walks this); LMS keeps its sales assignment hierarchy. `iam.users.manager_id` degrades to an optional org default or is retired.
- **JWT shrinks** to: `identity + platform_role + tenant/org + licensed_products`. Each product service resolves *its own* role for the user from *its own* table — the JWT no longer carries a single product `role`/`rank`.

---

## D4 — One shared Postgres cluster, schema-per-product

**Decision:** multi-repo code, **single shared database cluster**. NOT a database per product.

**Rationale:** a shared cluster preserves the three things the platform depends on:
1. **One identity** — every product reads the same `iam`/`entity` tenancy data.
2. **RLS + session-GUC reuse** — `app.current_org_id` / `app.current_tenant_id` and the `withRoleTx` recipe work identically for every product.
3. **Cross-product reporting** — "who's out today" + "their open leads" is a join, not an ETL.

**Ownership rule:** a repo may migrate **only its own schema**. Shared schemas (`iam`, `entity`, `geo`, `audit`) change only in `shared-repo`. Product repos migrate only their own schemas — `lms.*` (+ `marketing.*`/`ext.*`) / `hr.*` / `task.*`. Each product gets its own DB login role (`lms_svc`, `hr_svc`, `task_svc`) via `app_user`, per the existing recipe.

### Cross-repo database handling (SQL scripts + Drizzle types)

**Multi-repo ≠ multi-database** — the repos are a code-ownership boundary; the database is shared. DDL stays in idempotent **`db_scripts/*.sql` (the source of truth — no ORM/TS migrations)**; Drizzle files remain **query-layer types only**, hand-synced with the SQL.

**`db_scripts/` split by schema ownership:**

| Repo | `db_scripts/` owns |
|---|---|
| `shared-repo` | `iam`, `entity`, `geo`, `audit`, `entity.tenant_products`, roles, shared functions, tenant/user seed |
| `lms-repo` | `lms`, `marketing`, `ext` (+ lead/campaign/meta seed) |
| `hrms-repo` | `hr` (leave, attendance, employee) |
| `todo-repo` | `task` |

**Carve the schema-mixed scripts (part of Phase 5 extraction):** several current scripts create multiple schemas and must be split along schema lines — `01_init-db.sql` (shared parts → shared-repo; `crm`/`marketing`/`ext` → lms-repo), `01_init-lookup-data.sql` (by schema), `10_init-hr-task-schemas.sql` (`tenant_modules` → shared-repo; `hr` → hrms-repo; `task` → todo-repo); `11`/`12`/`13` → hrms-repo; `14` → todo-repo; seeds `02`–`06` by the schema they touch.

**Run order — shared-first (the one rule):** products FK into the core, so `shared-repo` scripts run first (creating `iam`/`entity`/`geo`), then each product's. Numbering is **local per repo** (each starts `01_…`); cross-repo order is **by dependency**, not a global number. Each repo keeps its own deploy script (a `db_deploy.ps1` clone); the parent workspace orchestrates shared → products for local dev. A product repo's scripts **cannot bootstrap a DB alone** (they assume the shared schemas exist) — state this in each product README.

**Drizzle table defs follow the same split:** shared table *types* (`iam.users`, `entity.organizations`, `geo.*`) published via `@platform/db`; product table *types* in the product repo, hand-synced with that repo's SQL. A cross-schema FK/join (e.g. `hr.employee_profiles.user_id → iam.users`) is a real same-database reference; in Drizzle it's a cross-package import of the shared table def (`.references(() => usersTable.id)`), which emits `REFERENCES iam.users(id)`.

---

## D5 — Shared code distribution (staged, no registry to start)

Distribution evolves with how builds happen — start with the lightest thing that works, add ceremony only when a build leaves the laptop.

**Stage 1 (now) — local pnpm workspace, no registry, no git-tags.**
All repos are cloned side-by-side under a parent folder with a root `pnpm-workspace.yaml` globbing every repo. pnpm symlinks `@platform/*` into each product exactly as inside a monorepo. Docker images are built **on the laptop** where all repos exist, so no cross-machine code fetch is needed.
- **Self-contained images:** build each service/app with `pnpm --filter <pkg> deploy ./build/<pkg> --prod`, which flattens all workspace deps into a real, symlink-free `node_modules`; the Dockerfile copies that folder. Ship images via `docker save | gzip` → copy to server → `docker load`. (Verify `pnpm deploy` flags against pnpm 9.x when wiring the first Dockerfile.)

**Stage 2 (when builds move off the laptop — CI or a second builder) — git-tag deps.**
Product `package.json` pins `"@platform/authz": "github:org/shared-repo#v1.3.0&path:/packages/authz"`. shared-repo tags releases (`git tag v1.3.0`); consumers bump the tag. The local workspace still overrides for live dev, so devs edit shared code without re-tagging. Requires each shared package to build on install (`prepare` script) or commit its `dist/`; private repo needs a CI read token.

**Stage 3 (only if publish cadence justifies it) — private registry** (GitHub Packages) with semver + changesets. Not needed until many consumers pull frequently.

**Trigger to advance a stage:** a build starts happening somewhere the sibling repos aren't checked out. Until then, Stage 1 is sufficient.

---

## D6 — Entitlements enforced centrally at the gateway

- `entity.tenant_products (tenant_id, product, plan, is_active, enabled_at)` — the subscription/licensing table.
- The **shared gateway** checks it on every proxied call → the single choke point. Turning a tenant's product off 403s all its calls regardless of which UI image is deployed.
- JWT carries `licensed_products` so UIs hide unlicensed tools without a round-trip.
- This is the subscription lever: per-product plans, trials, staged rollout, instant shutoff.

---

## D7 — Tenant-scoped configuration & lookups

**Decision:** every configuration and lookup table is **tenant-owned** and carries `tenant_id NOT NULL` + a strict `tenant_isolation_policy`. There are **no global/shared lookup rows**. Changing a lookup (a lead stage, a leave type, a task status, a role definition) for one tenant can never affect another.

**Reverses prior stance:** the earlier plan and current code treat several lookups as *global* (`task-statuses`, `task-priorities` are labelled "global"; HR plan made `leave_types`, `employment_types`, `attendance_statuses` global via admin-service). Under D7 these all become tenant-scoped.

**Applies to:** all `*.lookup`-style tables across every schema — lead stages/outcomes, interaction types, follow-up statuses, lead sources, marketing platforms, campaign statuses, task statuses/priorities, HR leave types/policies/holiday calendars/employment types/departments/designations/attendance statuses/shifts, **and role definitions** (`lms.member_roles`, `hr.member_roles` are per-tenant — a tenant can rename/re-rank its own roles without affecting others).

**Recipe per lookup table:** `id UUID PK`, `tenant_id UUID NOT NULL FK → entity.tenants`, natural-key `UNIQUE (tenant_id, name)`, standard audit + soft-delete columns, `tenant_isolation_policy` on `app.current_tenant_id`. Org-overridable configs additionally carry a nullable `org_id` (org row wins over tenant default), still under tenant RLS.

**The one real cost — default seeding.** With no global rows, a new tenant starts with empty lookups. Mitigation: **default seed sets are cloned into the tenant on tenant provisioning.** Keep versioned default catalogs (JSON/SQL fixtures in each product repo, e.g. `lms-repo/seeds/default-lead-stages.json`); tenant creation runs a `seedTenantDefaults(tenantId)` step that inserts a private copy per product the tenant is licensed for. Tenants edit their copy freely thereafter; updating a default catalog does **not** retroactively touch existing tenants (that would violate isolation) — it only affects tenants provisioned afterward, or an explicit opt-in "reset to defaults" action.

**Cross-tenant admin (`super_admin`) view:** platform staff manage a tenant's lookups by acting *within that tenant's context* (setting `app.current_tenant_id`), never through a global table. `lookup-admin` becomes tenant-context-aware rather than editing shared rows.

---

## D8 — Data storage & isolation axes

Every table sits on **two independent isolation axes**; both apply always:

| Axis | Mechanism | Prevents |
|---|---|---|
| **Product isolation** | Own schema (`lms.*` / `hr.*` / `task.*`) + **per-product DB role grants** (`lms_svc` sees only `lms.*` (+`marketing`/`ext`) + read-only shared `iam`/`entity`/`geo`) | One product's code touching another product's tables |
| **Tenant isolation** | RLS on `app.current_tenant_id` (D7) | A tenant reading another tenant's rows |

Product isolation is enforced at the **`GRANT` level**, not by convention: `hr_svc` physically cannot read `lms.marketing_leads`.

**Three rules that keep products physically separable:**
1. **No hard FK across product schemas.** FK to shared schemas (`iam.users`, `entity.organizations`, `geo.*`) is fine — they are stable platform primitives. Cross-product references are **soft links** (`related_entity_type` + `related_entity_id`), resolved via API/view, never a DB FK.
2. **No cross-product joins in operational code.** LMS needing HR data (e.g. "is this rep on leave") calls hr-service or reads a published, contract-stable view — it never joins `hr.*` directly.
3. **FK to shared schemas expected** — that is the shared core doing its job.

**Portability payoff:** because products are logically separable (own schema, own role, no cross-product FKs/joins), physically extracting a product's data to its own database/cluster later is a cheap migration, not a rewrite. We keep physical separation a future option without paying for it now.

**The reporting exception:** D4's "cross-product reporting is a join, not an ETL" holds only in a **read-only analytics context** — a dedicated reporting role (ideally on a read replica) that is explicitly allowed to join across schemas. Operational product code stays walled.

**Object/file storage** (attendance selfies, documents, lead attachments): **product + tenant scoped paths** — `s3://platform/{product}/{tenant_id}/...` or a bucket per product. Never a flat shared bucket — keeps per-tenant retention/purge (e.g. 90-day selfie purge, DPDP) and per-product lifecycle rules clean.

---

## Migration sequence (order matters)

1. **Clean boundaries inside the current monorepo first.** Split `@crm/permissions` → `@platform/authz` + `@lms/authz` + `@hr/authz`; move product UI into feature packages + `(lms)/(hr)/(todo)` route groups; add `entity.tenant_products`. Add a dependency-lint rule so a product can't import another. *(Untangling cross-imports before a repo boundary exists is 10× cheaper.)*
   Also (D7): migrate all `global`-labelled lookups to `tenant_id NOT NULL` + tenant RLS, and add a `seedTenantDefaults(tenantId)` provisioning step with versioned default catalogs.
2. **Stand up the private registry**; publish `@platform/*`.
3. **Authorization decoupling** — per-product role tables, per-product hierarchy, shrink the JWT — while still one repo and cheap. Migrate existing `hr_admin` + sales roles into their product tables.
4. **Extract repos** one at a time: `shared-repo` first, then `lms-repo`, `hrms-repo`, `todo-repo`, each consuming published `@platform/*`.
5. **Split web** into per-product images on the shared cookie domain + product switcher.
6. **Build `gym-repo`** on the clean template — new schema, new role table, new reporting model, new image, **zero edits to LMS/HR** — as the proof the seams hold.

---

## Explicitly rejected

- **Separate database per product** — breaks one-login, RLS reuse, and cross-product reporting.
- **Copying identity/gateway into each product repo** — forks auth; SSO and central entitlement enforcement become impossible.
- **One shell web app for all products** — conflicts with independent per-product image deploy/shutdown (D2).
- **Splitting repos before cleaning boundaries** — turns internal refactors into cross-repo, cross-version chores.
- **Global/shared lookup rows** (D7) — any lookup edit could leak across tenants; replaced by per-tenant copies + provisioning-time seeding.
