# PostgreSQL Templates Reference

Copy-paste templates matching `db_scripts/*.sql`. Replace `<schema>` / `<table>` / `<concept>`.
Read `SKILL.md` first. All templates are idempotent and belong in a numbered script.

---

## 1. Shared functions (defined once in `01_init-db.sql`)

Reuse these — do not redefine per table.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes() for gen_uuidv7()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Time-ordered UUID v7 (avoids v4 random-insert index fragmentation)
CREATE OR REPLACE FUNCTION public.gen_uuidv7() RETURNS UUID AS $$ /* … */ $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := CLOCK_TIMESTAMP(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.soft_delete_row() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('UPDATE %I.%I SET is_deleted = TRUE, deleted_at = NOW(), '
              || 'deleted_by = NULLIF(current_setting(''app.current_user_id'', true), '''')::uuid '
              || 'WHERE id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME) USING OLD.id;
  RETURN NULL;   -- cancel the physical DELETE
END; $$;
```

---

## 2. Lookup table

```sql
CREATE TABLE IF NOT EXISTS <schema>.<concept> (
  id          UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  name        TEXT    NOT NULL UNIQUE,   -- machine key (stable, used in app/API)
  label       TEXT    NOT NULL,          -- display text
  description TEXT,
  sort_order  INT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Seed (in 01_init-lookup-data.sql)
INSERT INTO <schema>.<concept> (name, label, sort_order) VALUES
  ('new',       'New',       1),
  ('contacted', 'Contacted', 2),
  ('closed',    'Closed',    3)
ON CONFLICT (name) DO NOTHING;
```

For `geo`-style fixed reference data only, the identity variant:

```sql
CREATE TABLE IF NOT EXISTS geo.<concept> (
  id   SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL UNIQUE
);
```

---

## 3. Domain table + RLS + triggers (full template)

```sql
CREATE TABLE IF NOT EXISTS lms.<table> (
  id            UUID    PRIMARY KEY DEFAULT public.gen_uuidv7(),
  org_id        UUID    NOT NULL REFERENCES entity.organizations(id) ON DELETE RESTRICT,
  -- lookup FKs (expose name+label via the view, not raw id alone)
  status_id     UUID    REFERENCES lms.<status_lookup>(id) ON DELETE RESTRICT,
  -- own columns
  title         TEXT    NOT NULL,
  notes         TEXT,
  -- standard columns
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID,
  metadata      JSONB   NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
  CONSTRAINT chk_<table>_active_deleted CHECK (NOT (is_active AND is_deleted))
);

-- Indexes: FK columns, common filters, pagination order
CREATE INDEX IF NOT EXISTS idx_<table>_org_id     ON lms.<table> (org_id);
CREATE INDEX IF NOT EXISTS idx_<table>_status_id  ON lms.<table> (status_id);
CREATE INDEX IF NOT EXISTS idx_<table>_created_at ON lms.<table> (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_<table>_title_trgm ON lms.<table> USING gin (title gin_trgm_ops);

-- Triggers
DROP TRIGGER IF EXISTS trg_<table>_updated_at  ON lms.<table>;
CREATE TRIGGER trg_<table>_updated_at  BEFORE UPDATE ON lms.<table>
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_<table>_soft_delete ON lms.<table>;
CREATE TRIGGER trg_<table>_soft_delete BEFORE DELETE ON lms.<table>
  FOR EACH ROW EXECUTE FUNCTION public.soft_delete_row();

-- Row-Level Security
ALTER TABLE lms.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation_policy ON lms.<table>
  AS PERMISSIVE FOR ALL TO app_user
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

CREATE POLICY tenant_isolation_policy ON lms.<table>
  AS PERMISSIVE FOR ALL TO tenant_admin
  USING      (org_id IN (SELECT id FROM entity.organizations
                         WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
  WITH CHECK (org_id IN (SELECT id FROM entity.organizations
                         WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
```

---

## 4. Generated column

```sql
full_name TEXT GENERATED ALWAYS AS (
  btrim(coalesce(first_name,'') || ' ' || coalesce(middle_name,'') || ' ' || coalesce(last_name,''))
) STORED,
-- never insert full_name directly
```

---

## 5. View (`vw_` + security_invoker)

```sql
CREATE OR REPLACE VIEW lms.vw_<purpose> WITH (security_invoker = true) AS
SELECT
  t.id,
  t.org_id,
  o.name        AS org_name,
  t.title,
  t.status_id,
  s.name        AS status,        -- machine key
  s.label       AS status_label,  -- display
  t.is_active,
  t.is_deleted,                    -- exposed so the repository can filter NOT is_deleted
  t.created_at,
  t.updated_at
FROM lms.<table> t
JOIN      entity.organizations o ON o.id = t.org_id
LEFT JOIN lms.<status_lookup>  s ON s.id = t.status_id;
```

- `vw_` prefix, purpose name. `security_invoker = true` is mandatory (RLS applies through the view).
- Resolve every FK to `name` + `label` (and keep the raw id). No tenant/org/`is_deleted` filter here.

---

## 6. Drizzle mirror (`packages/db/src/schema/`)

Keep the typed schema in sync with the SQL. Tables map camelCase → snake_case columns.

```ts
// packages/db/src/schema/tables/<table>.table.ts
import { uuid, text, boolean, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lmsSchema } from '../pg-schemas';

export const <table>Table = lmsSchema.table('<table>', {
  id:        uuid('id').primaryKey().default(sql`gen_uuidv7()`),
  orgId:     uuid('org_id').notNull(),
  statusId:  uuid('status_id'),
  title:     text('title').notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  metadata:  jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
```

Register it in `packages/db/src/schema/index.ts` so services can `import { <table>Table } from '@crm/db/schema'`.

---

## 7. Refactor / audit output shape

```
INVENTORY
  Schemas:            geo, entity, iam, lms, marketing, audit, ext, hr, task
  Tables:             [...]
  Views (vw_*):       [...]
  Lookup tables:      [...]
  RLS-enabled tables: [...]
  Triggers / indexes: [...]

GAP TABLE
| Gap | Object | Issue | Fix | Risk |
|-----|--------|-------|-----|------|
| Missing view          | lms.foo        | no lms.vw_foo                    | add view          | Safe |
| Missing RLS           | lms.foo        | no app_user/tenant_admin policy  | add policies      | Migration |
| Missing security_invoker | lms.vw_bar  | view runs as owner (leak risk)   | add WITH(...)     | Safe |
| Unnormalized column   | lms.foo.kind   | bare TEXT enum                   | lookup + FK       | Migration |
| Wrong PK type         | lms.baz.id     | SMALLINT on API-facing table     | gen_uuidv7()      | Breaking |
| Missing soft delete   | lms.foo        | no is_deleted + trigger          | add col + trigger | Migration |

Deliver fixes as a NEW numbered script (db_scripts/NN_*.sql), additive where possible.
Wrap destructive changes in BEGIN; … COMMIT;. Never drop/rename without confirmation.
```
