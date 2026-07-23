-- ===================================================================
-- Tenant-scope the five LMS lead catalogs.
--
-- lms.lead_stage / lead_stage_outcome / interaction_types /
-- follow_up_statuses / lead_sources each carry a tenant_id column and are
-- policed by the tenant-scoped RLS in 06_rls.sql, but were seeded as GLOBAL
-- rows (tenant_id IS NULL) by 07_seed_lookup_data.sql and never registered in
-- entity.catalog_versions. `NULL = <tenant uuid>` is NULL, never true, so once
-- RLS actually applied to the service logins every row became invisible: leads
-- kept their stage_id but the join returned nothing, and Status / Outcome /
-- Lead Source / Follow-up all rendered blank.
--
-- This gives every tenant its own copy, repoints existing data at the copy for
-- its own tenant, and drops the global rows, so the existing RLS predicate is
-- satisfied as written rather than being loosened to admit NULL.
--
-- Idempotent: re-running finds no tenant_id IS NULL rows and does nothing.
-- Run inside one transaction — a partial apply would orphan FKs.
-- ===================================================================

BEGIN;

-- Run as the table owner / a superuser (the deploy scripts connect as postgres):
-- step 1 issues ALTER TABLE, and the migration must also see the global rows it
-- is replacing, which the tenant policies would otherwise hide. root_service is
-- BYPASSRLS but does not own these tables, so it cannot do the ALTERs.

-- ── 1. Uniqueness must be per tenant ───────────────────────────────
-- These were UNIQUE(name), which makes per-tenant copies impossible: two
-- tenants cannot both own a stage called 'new'. The catalogs already wired
-- into entity.catalog_versions (task.task_statuses, hr.leave_types, ...) all
-- use (tenant_id, name); this brings these five in line.
ALTER TABLE lms.lead_stage         DROP CONSTRAINT IF EXISTS lead_stage_name_key;
ALTER TABLE lms.interaction_types  DROP CONSTRAINT IF EXISTS interaction_types_name_key;
ALTER TABLE lms.follow_up_statuses DROP CONSTRAINT IF EXISTS follow_up_statuses_name_key;
ALTER TABLE lms.lead_sources       DROP CONSTRAINT IF EXISTS lead_sources_name_key;

-- DROP-then-ADD, not a bare ADD: `ADD CONSTRAINT` has no IF NOT EXISTS form, so
-- a bare ADD makes this whole script fail on the second run — which it must not,
-- both because the header promises idempotency and because db_deploy.ps1 now
-- runs it as part of the standard sequence.
ALTER TABLE lms.lead_stage         DROP CONSTRAINT IF EXISTS uq_lead_stage_tenant_name;
ALTER TABLE lms.interaction_types  DROP CONSTRAINT IF EXISTS uq_interaction_types_tenant_name;
ALTER TABLE lms.follow_up_statuses DROP CONSTRAINT IF EXISTS uq_follow_up_statuses_tenant_name;
ALTER TABLE lms.lead_sources       DROP CONSTRAINT IF EXISTS uq_lead_sources_tenant_name;

ALTER TABLE lms.lead_stage
  ADD CONSTRAINT uq_lead_stage_tenant_name UNIQUE (tenant_id, name);
ALTER TABLE lms.interaction_types
  ADD CONSTRAINT uq_interaction_types_tenant_name UNIQUE (tenant_id, name);
ALTER TABLE lms.follow_up_statuses
  ADD CONSTRAINT uq_follow_up_statuses_tenant_name UNIQUE (tenant_id, name);
ALTER TABLE lms.lead_sources
  ADD CONSTRAINT uq_lead_sources_tenant_name UNIQUE (tenant_id, name);
-- lead_stage_outcome keeps UNIQUE (stage_id, name): stage_id is itself
-- tenant-specific once the stages above are cloned, so the pair is per tenant.

-- ── 2. Clone each global row for every tenant ──────────────────────
-- old_id -> (tenant_id, new_id), so step 3 can repoint each row at the copy
-- belonging to its own tenant.
CREATE TEMP TABLE _cat_map (
  catalog   TEXT,
  old_id    UUID,
  tenant_id UUID,
  new_id    UUID
) ON COMMIT DROP;

-- lead_stage first: lead_stage_outcome and the CAPI map both hang off it.
WITH src AS (
  SELECT s.id AS old_id, t.id AS tid, public.gen_uuidv7() AS new_id,
         s.name, s.label, s.description, s.sort_order,
         s.followup_required, s.is_rejected, s.is_terminated, s.is_active
  FROM lms.lead_stage s CROSS JOIN entity.tenants t
  WHERE s.tenant_id IS NULL
), ins AS (
  INSERT INTO lms.lead_stage
    (id, tenant_id, name, label, description, sort_order,
     followup_required, is_rejected, is_terminated, is_active)
  SELECT new_id, tid, name, label, description, sort_order,
         followup_required, is_rejected, is_terminated, is_active
  FROM src
  RETURNING id
)
INSERT INTO _cat_map SELECT 'lead_stage', old_id, tid, new_id FROM src;

WITH src AS (
  SELECT o.id AS old_id, m.tenant_id AS tid, public.gen_uuidv7() AS new_id,
         m.new_id AS new_stage_id,
         o.name, o.label, o.description, o.requires_comment, o.sort_order, o.is_active
  FROM lms.lead_stage_outcome o
  JOIN _cat_map m ON m.catalog = 'lead_stage' AND m.old_id = o.stage_id
  WHERE o.tenant_id IS NULL
), ins AS (
  INSERT INTO lms.lead_stage_outcome
    (id, tenant_id, stage_id, name, label, description, requires_comment, sort_order, is_active)
  SELECT new_id, tid, new_stage_id, name, label, description, requires_comment, sort_order, is_active
  FROM src
  RETURNING id
)
INSERT INTO _cat_map SELECT 'lead_stage_outcome', old_id, tid, new_id FROM src;

WITH src AS (
  SELECT i.id AS old_id, t.id AS tid, public.gen_uuidv7() AS new_id,
         i.name, i.label, i.description, i.is_active
  FROM lms.interaction_types i CROSS JOIN entity.tenants t
  WHERE i.tenant_id IS NULL
), ins AS (
  INSERT INTO lms.interaction_types (id, tenant_id, name, label, description, is_active)
  SELECT new_id, tid, name, label, description, is_active FROM src
  RETURNING id
)
INSERT INTO _cat_map SELECT 'interaction_types', old_id, tid, new_id FROM src;

WITH src AS (
  SELECT f.id AS old_id, t.id AS tid, public.gen_uuidv7() AS new_id,
         f.name, f.label, f.description, f.is_active
  FROM lms.follow_up_statuses f CROSS JOIN entity.tenants t
  WHERE f.tenant_id IS NULL
), ins AS (
  INSERT INTO lms.follow_up_statuses (id, tenant_id, name, label, description, is_active)
  SELECT new_id, tid, name, label, description, is_active FROM src
  RETURNING id
)
INSERT INTO _cat_map SELECT 'follow_up_statuses', old_id, tid, new_id FROM src;

WITH src AS (
  SELECT l.id AS old_id, t.id AS tid, public.gen_uuidv7() AS new_id,
         l.name, l.label, l.is_active
  FROM lms.lead_sources l CROSS JOIN entity.tenants t
  WHERE l.tenant_id IS NULL
), ins AS (
  INSERT INTO lms.lead_sources (id, tenant_id, name, label, is_active)
  SELECT new_id, tid, name, label, is_active FROM src
  RETURNING id
)
INSERT INTO _cat_map SELECT 'lead_sources', old_id, tid, new_id FROM src;

-- ── 3. Repoint existing data at its own tenant's copy ──────────────
-- The referencing tables carry org_id, not tenant_id, so the tenant comes from
-- entity.organizations.
--
-- Every column of a row moves in ONE statement. Splitting them per column
-- destroys data: lms.check_lead_stage_outcome is a BEFORE UPDATE trigger that
-- fires as soon as stage_id changes, sees NEW.stage_id (already the tenant copy)
-- beside NEW.outcome_id (still the old global row), decides the pair is
-- inconsistent and silently NULLs outcome_id and outcome_comment. A
-- stage-then-outcome sequence therefore wipes the outcome of every lead that
-- had one before the outcome statement ever runs.
UPDATE lms.marketing_leads ml
SET stage_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage' AND m.old_id = ml.stage_id AND m.tenant_id = o.tenant_id),
      ml.stage_id),
    outcome_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage_outcome' AND m.old_id = ml.outcome_id AND m.tenant_id = o.tenant_id),
      ml.outcome_id),
    source_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_sources' AND m.old_id = ml.source_id AND m.tenant_id = o.tenant_id),
      ml.source_id)
FROM entity.organizations o
WHERE o.id = ml.org_id
  -- Nothing cloned means nothing to repoint. Without this a re-run rewrites
  -- every lead with its own values, and the BEFORE UPDATE trigger bumps
  -- updated_at on all of them — churn that also invalidates any optimistic
  -- concurrency token a client is holding.
  AND EXISTS (SELECT 1 FROM _cat_map);

UPDATE lms.lead_interactions li
SET interaction_type_id = m.new_id
FROM entity.organizations o, _cat_map m
WHERE o.id = li.org_id
  AND m.catalog = 'interaction_types' AND m.old_id = li.interaction_type_id AND m.tenant_id = o.tenant_id;

UPDATE lms.lead_follow_ups lf
SET stage_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage' AND m.old_id = lf.stage_id AND m.tenant_id = o.tenant_id),
      lf.stage_id),
    outcome_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage_outcome' AND m.old_id = lf.outcome_id AND m.tenant_id = o.tenant_id),
      lf.outcome_id),
    status_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'follow_up_statuses' AND m.old_id = lf.status_id AND m.tenant_id = o.tenant_id),
      lf.status_id)
FROM entity.organizations o
WHERE o.id = lf.org_id;

UPDATE lms.lead_status_log l
SET old_stage_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage' AND m.old_id = l.old_stage_id AND m.tenant_id = o.tenant_id),
      l.old_stage_id),
    new_stage_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage' AND m.old_id = l.new_stage_id AND m.tenant_id = o.tenant_id),
      l.new_stage_id),
    old_outcome_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage_outcome' AND m.old_id = l.old_outcome_id AND m.tenant_id = o.tenant_id),
      l.old_outcome_id),
    new_outcome_id = COALESCE(
      (SELECT m.new_id FROM _cat_map m
        WHERE m.catalog = 'lead_stage_outcome' AND m.old_id = l.new_outcome_id AND m.tenant_id = o.tenant_id),
      l.new_outcome_id)
FROM entity.organizations o
WHERE o.id = l.org_id;

-- ext.lead_stage_capi_event_map has no org/tenant column: it mapped each GLOBAL
-- stage to a CAPI event. Fan it out to one row per tenant stage, keeping
-- UNIQUE(stage_id) valid because the cloned stage ids are tenant-specific.
INSERT INTO ext.lead_stage_capi_event_map (stage_id, capi_event_type_id)
SELECT m.new_id, e.capi_event_type_id
FROM ext.lead_stage_capi_event_map e
JOIN _cat_map m ON m.catalog = 'lead_stage' AND m.old_id = e.stage_id
ON CONFLICT (stage_id) DO NOTHING;

DELETE FROM ext.lead_stage_capi_event_map e
USING lms.lead_stage s
WHERE s.id = e.stage_id AND s.tenant_id IS NULL;

-- ── 4. Drop the global rows ────────────────────────────────────────
-- Outcomes before stages (FK), and only after every reference above moved.
DELETE FROM lms.lead_stage_outcome WHERE tenant_id IS NULL;
DELETE FROM lms.lead_stage         WHERE tenant_id IS NULL;
DELETE FROM lms.interaction_types  WHERE tenant_id IS NULL;
DELETE FROM lms.follow_up_statuses WHERE tenant_id IS NULL;
DELETE FROM lms.lead_sources       WHERE tenant_id IS NULL;

-- ── 5. Refuse to leave a half-migrated database ────────────────────
DO $verify$
DECLARE
  v_orphans INT;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM lms.marketing_leads ml
  JOIN entity.organizations o ON o.id = ml.org_id
  LEFT JOIN lms.lead_stage s ON s.id = ml.stage_id AND s.tenant_id = o.tenant_id
  WHERE ml.stage_id IS NOT NULL AND s.id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'aborting: % leads reference a stage outside their tenant', v_orphans;
  END IF;
END $verify$;

COMMIT;
