---
name: pg-database-dev
description: >
  Authoritative standard for PostgreSQL work in this CRM monorepo — schema design, migrations,
  views, lookups, indexes, seed data, and Row-Level Security. Triggers on any mention of
  PostgreSQL/Postgres, schema/table/view/migration/index/RLS/policy design, "model this data",
  "add a table/column/view", or auditing/refactoring existing SQL in db_scripts/.
---

# PostgreSQL — CRM Monorepo Skill

> This describes how the database is *actually* built. The SQL in `db_scripts/*.sql` is the
> **authoritative source of truth**; the Drizzle schema in `@crm/db` mirrors it for typed queries.
> Follow every rule so new SQL reads like the existing schema.

Stack facts: multi-schema database, **Row-Level Security as the tenancy boundary**, time-ordered
UUID v7 keys, `vw_`-prefixed `security_invoker` views, boolean soft-delete, plain ordered SQL
scripts (no drizzle-kit migrations).

---

## 0. How the DB is built & deployed

- Authored as **ordered, idempotent SQL scripts**: `db_scripts/NN_name.sql`
  (`01_init-db.sql`, `01_init-lookup-data.sql`, `10_init-hr-task-schemas.sql`, …).
- Idempotent everywhere: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW/FUNCTION`,
  `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER …`, guarded `CREATE ROLE` blocks.
- Applied by `db_scripts/db_deploy.ps1`; applied versions tracked in `public.schema_versions`.
- **Never edit an already-applied script to change shipped structure** — add a new numbered
  script. Editing is fine only for still-in-development scripts.
- After changing SQL, mirror the change in the Drizzle schema under
  `packages/db/src/schema/` and update `docs/DB_model.md`.

---

## 1. Schemas — the database is namespaced

Objects live in domain schemas, **not** a flat `public`:

| Schema      | Holds                                                        |
|-------------|-------------------------------------------------------------|
| `geo`       | Reference data: countries, states, cities                   |
| `entity`    | Tenants, organizations, org/tenant lookups                  |
| `iam`       | Users, roles, org mappings                                  |
| `lms`       | Leads, stages, interactions, follow-ups, assignments        |
| `marketing` | Campaigns, platforms, campaign statuses                     |
| `audit`     | Activity log, history, audit trail                          |
| `ext`       | External integration (API clients, Meta CAPI)               |
| `hr`, `task`| HR / leave / attendance / tasks                             |
| `public`    | Shared functions (`gen_uuidv7`, `set_updated_at`, …), `schema_versions` |

Always schema-qualify (`lms.marketing_leads`, `entity.organizations`). Drizzle mirrors this via
`pgSchema('lms')` etc. in `packages/db/src/schema/pg-schemas.ts`.

---

## 2. Row-Level Security — the tenancy boundary (read first)

RLS is what isolates tenants and orgs. The application never adds `WHERE tenant_id = …` for
security; it sets session context and lets policies enforce it.

**Roles** (`01_init-db.sql`):
- `app_user` — `NOLOGIN NOINHERIT`; org-scoped end users. Default path.
- `tenant_admin` — `NOLOGIN NOINHERIT`; tenant-wide access across its orgs.
- `root_service` — `LOGIN … BYPASSRLS`; the service account for system operations only.

**Session GUCs** set per transaction by `@crm/db`'s `withRoleTx` (see the Node skill):
`app.current_org_id`, `app.current_tenant_id`, `app.current_user_id`.

**Policy pattern:**

```sql
ALTER TABLE lms.some_table ENABLE ROW LEVEL SECURITY;

-- org-scoped end users
CREATE POLICY org_isolation_policy ON lms.some_table
  AS PERMISSIVE FOR ALL TO app_user
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- tenant admins (all orgs in their tenant)
CREATE POLICY tenant_isolation_policy ON lms.some_table
  AS PERMISSIVE FOR ALL TO tenant_admin
  USING (org_id IN (
    SELECT id FROM entity.organizations
    WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
  WITH CHECK (org_id IN (
    SELECT id FROM entity.organizations
    WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
```

**RLS rules:**
- Any table holding org/tenant-scoped rows gets `ENABLE ROW LEVEL SECURITY` + policies for
  `app_user` and `tenant_admin`. Reference/lookup data (geo, global lookups) does not.
- Always read GUCs as `NULLIF(current_setting('app.current_org_id', true), '')::uuid` — the
  `true` (missing_ok) + `NULLIF` guards against unset context.
- Always include `WITH CHECK` so writes can't escape scope (this is what pins an `app_user` to
  its own `org_id` on insert/update).
- The `root_service` role bypasses RLS — reserved for `withServiceTx` system work only.

---

## 3. Primary keys

| Table kind                                            | PK type                                              |
|-------------------------------------------------------|------------------------------------------------------|
| Domain + most lookup tables (lms/entity/marketing/…)  | `UUID PRIMARY KEY DEFAULT public.gen_uuidv7()`       |
| `geo` reference data (countries/states/cities)        | `SMALLINT` / `INTEGER … GENERATED ALWAYS AS IDENTITY`|
| A few internal id tables (e.g. `iam.user_roles`)      | `SMALLINT … GENERATED ALWAYS AS IDENTITY`            |

`public.gen_uuidv7()` produces **time-ordered** UUIDs (avoids the random-insert B-tree
fragmentation of v4) — it's the default for anything API-facing or high-volume. Use identity
`SMALLINT/INTEGER` only for small, fixed reference sets that never leave the system.

```sql
id UUID     PRIMARY KEY DEFAULT public.gen_uuidv7(),           -- domain / lookup
id SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,          -- geo reference data
```

---

## 4. Lookup tables (normalization)

Bounded, label-able, repeating values go in a lookup table — never a bare enum-`TEXT` column.
The house shape (see `lms.lead_stage`, `lms.interaction_types`, `marketing.marketing_platforms`):

```sql
CREATE TABLE IF NOT EXISTS lms.<concept> (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  name        TEXT    NOT NULL UNIQUE,   -- machine key used in app logic / API (stable, never rename)
  label       TEXT    NOT NULL,          -- human display text (freely editable)
  description TEXT,
  sort_order  INT     NOT NULL DEFAULT 0,-- include when the set is shown in a dropdown
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
```

- The machine key column is **`name`** (unique), not `code`. The display column is `label`.
- Add `sort_order` for anything rendered as an ordered list; add domain booleans as needed
  (e.g. `lead_stage` has `followup_required`, `is_rejected`, `is_terminated`).
- Reference a lookup with `<concept>_id UUID REFERENCES <schema>.<concept>(id) ON DELETE RESTRICT`.
- Seed data lives in `01_init-lookup-data.sql`.

---

## 5. Views — `vw_` prefix, `security_invoker`

Reads go through views that resolve FKs to human-readable `name`/`label` and join related
tables, so the app never assembles joins ad hoc.

```sql
CREATE OR REPLACE VIEW lms.vw_<purpose> WITH (security_invoker = true) AS
SELECT
  ml.id AS lead_id,
  ml.org_id,
  o.name  AS org_name,
  ls.name AS stage,  ls.label AS stage_label,
  u.full_name AS assigned_rep_name,
  ml.is_deleted,      -- expose so the repository can filter
  ml.created_at, ml.updated_at
FROM lms.marketing_leads ml
JOIN      entity.organizations o  ON o.id  = ml.org_id
LEFT JOIN lms.lead_stage       ls ON ls.id = ml.stage_id
LEFT JOIN iam.users            u  ON u.id  = ml.assigned_user_id;
```

**View rules:**
- Name is `<schema>.vw_<purpose>` — **`vw_` prefix**, purpose-named (`vw_dashboard_leads`,
  `vw_lead_followup_timeline`, `vw_rep_performance`). Not a `_vw` suffix, not `<table>_view`.
- Always `WITH (security_invoker = true)` so the base tables' RLS applies through the view for
  the calling role. (Without it a view runs as its owner and leaks across tenants.)
- Resolve every FK: `<concept>_id` → also expose `<concept>` (name) and `<concept>_label`;
  user FKs → `<name>_name` (e.g. `assigned_rep_name`). Keep the raw id too.
- Do **not** bake `tenant_id`/`org_id` or `is_deleted` filtering into the view — expose the
  columns and let the repository add `NOT is_deleted` / any extra scoping. (RLS handles isolation.)
- `LEFT JOIN` for optional relationships; `JOIN` only when the row is meaningless without it.

---

## 6. Standard columns & triggers

Shared functions live in `public` and are reused by every table:

- `public.set_updated_at()` — `BEFORE UPDATE`, sets `updated_at := CLOCK_TIMESTAMP()`.
- `public.soft_delete_row()` — `BEFORE DELETE`, converts a delete into
  `is_deleted = TRUE, deleted_at = now(), deleted_by = current user`.
- `public.set_created_by()` / `public.set_org_id()` — `BEFORE INSERT`, populate audit/scoping
  columns from the session GUCs.

Every domain table carries:

```sql
is_active   BOOLEAN NOT NULL DEFAULT TRUE,
is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,   -- soft delete is a BOOLEAN, not deleted_at alone
deleted_at  TIMESTAMPTZ,
deleted_by  UUID,
metadata    JSONB   NOT NULL DEFAULT '{}',
created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
updated_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
CONSTRAINT chk_<table>_active_deleted CHECK (NOT (is_active AND is_deleted))
```

and wires the triggers:

```sql
DROP TRIGGER IF EXISTS trg_<table>_updated_at  ON <schema>.<table>;
CREATE TRIGGER trg_<table>_updated_at  BEFORE UPDATE ON <schema>.<table>
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_<table>_soft_delete ON <schema>.<table>;
CREATE TRIGGER trg_<table>_soft_delete BEFORE DELETE ON <schema>.<table>
  FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();
```

Timestamps default to `CLOCK_TIMESTAMP()` (not `NOW()`). Computed columns use
`GENERATED ALWAYS AS (…) STORED` (e.g. `iam.users.full_name`, `lms.marketing_leads.full_name`) —
never insert them directly.

---

## 7. Data types

Smallest correct type. Same table as most Postgres shops, with local specifics:

| Data                       | Use                                      |
|----------------------------|------------------------------------------|
| True/false                 | `BOOLEAN`                                |
| Machine key / label / notes| `TEXT` (the repo favours `TEXT` over sized `VARCHAR` for most strings) |
| Money                      | `NUMERIC(15,2)`                          |
| Timestamps                 | `TIMESTAMPTZ` (default `CLOCK_TIMESTAMP()`) |
| Date only                  | `DATE`                                   |
| JSON                       | `JSONB` (default `'{}'` for metadata)    |
| Domain / API id            | `UUID` (`public.gen_uuidv7()`)           |
| geo reference id           | `SMALLINT` / `INTEGER` identity          |

---

## 8. Foreign keys & indexes

- Name FKs are usually declared inline (`REFERENCES <schema>.<table>(id) ON DELETE RESTRICT`).
  Use `RESTRICT` by default; `CASCADE` only when the child is meaningless without the parent;
  `SET NULL` for optional links.
- Index every FK, every common filter column, and `created_at` for paginated reads. For
  org/tenant tables prefer composite `(org_id, …)` indexes. Use `pg_trgm` GIN indexes for
  `ILIKE` search columns (extension enabled in `01_init-db.sql`).

---

## 9. Extensions & shared functions

`01_init-db.sql` enables `pgcrypto`, `pg_trgm`, `btree_gin` (and `vector` where available) and
defines `public.gen_uuidv7()`, `public.set_updated_at()`, `public.soft_delete_row()`,
`public.set_created_by()`, `public.set_org_id()`. Reuse these — do not redefine per table.

---

## 10. Seed data

- Lookups: seed every `name`/`label` (incl. inactive) in `01_init-lookup-data.sql`.
- Demo/domain data: seed scripts (`02-…`, `03-…`) cover multiple tenants/orgs, every
  status/stage, nullable-column and boundary cases, and soft-deleted rows.

---

## 11. Absolute Prohibitions

- Store a bounded/label-able value as bare `TEXT` instead of a lookup FK.
- Create a view without `WITH (security_invoker = true)`, or name it `_vw`/`_view` instead of `vw_`.
- Bake `tenant_id`/`org_id`/`is_deleted` filtering into a view (RLS + the repository do that).
- Ship an org/tenant table without RLS policies for `app_user` and `tenant_admin` (incl. `WITH CHECK`).
- Default to `SMALLINT` identity for API-facing tables — use `public.gen_uuidv7()`.
- Use `code` for the machine key — the convention is `name` (unique) + `label`.
- Hard-delete a domain row — soft delete via `is_deleted` (the `soft_delete_row` trigger handles it).
- Read GUCs without the `NULLIF(current_setting(…, true), '')::uuid` guard.
- Edit an already-applied `db_scripts` file to change shipped structure — add a new numbered script.
- Forget to mirror a schema change into `@crm/db` and `docs/DB_model.md`.

---

## Refactor / Audit mode

When auditing existing SQL: read every `db_scripts/*.sql` first, produce an inventory
(schemas, tables, views, lookups, RLS-enabled tables, triggers, indexes), then a gap table
against the rules above (missing `vw_` view, missing RLS policy / `WITH CHECK`, missing
`security_invoker`, unnormalized column, wrong PK type, missing `is_deleted`/triggers, missing
FK index). Classify each gap Safe / Migration-needed / Breaking. Deliver fixes as a **new
numbered script**, additive where possible; wrap destructive changes in `BEGIN; … COMMIT;`; and
never drop/rename a column or table without explicit confirmation. See `templates.md`.

## Read next
- `templates.md` — full copy-paste templates (lookup, domain table + RLS + triggers, view).
