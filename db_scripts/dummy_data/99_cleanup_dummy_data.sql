-- ===================================================================
-- dummy_data/99_cleanup_dummy_data.sql
--
-- Removes EVERYTHING created by dummy_data/01-03, leaving the database in
-- exactly the state a schema + reference_data deploy produces.
--
-- Run it when you want the demo data gone:
--   psql -U postgres -d <db> -v ON_ERROR_STOP=1 -f 99_cleanup_dummy_data.sql
--
-- It is NOT part of any deploy. The previous teardown (12a/12b/12c) was
-- listed in db_deploy.ps1's demo-seed sequence, so every default deploy
-- seeded two tenants and ~5000 leads and then immediately deleted them --
-- and the scripts that ran afterwards found no tenants and silently did
-- nothing. Cleanup is a tool you invoke, never a deploy step.
--
-- WHAT IT TARGETS
--
-- The tenants recorded in public._dummy_data_tenants by dummy_data/01. The
-- old script hardcoded two UUIDs, so a third demo tenant would have been
-- left behind along with everything under it. If the registry table is
-- missing (data seeded by an older script set) it falls back to the two
-- historical demo tenant ids.
--
-- Everything under those tenants goes, including real rows created by the
-- app on top of them -- that is what "remove the demo tenants" means.
--
-- WHY THE DELETES ARE EXPLICIT
--
-- The old teardown leaned on FK cascades and leaked
-- entity.tenant_catalog_versions plus every per-tenant catalog row, so a
-- reseed found catalogs "already provisioned" and skipped them. Deleting
-- each table by name is longer but it is verifiable, and the final block
-- fails loudly rather than leaving a half-cleaned database.
--
-- Safe to re-run: every DELETE is scoped by a subquery, so a second run
-- finds nothing left.
-- ===================================================================

BEGIN;

-- entity.tenants / organizations / iam.users / marketing.ad_campaigns /
-- lms.marketing_leads / lead_interactions / lead_follow_ups all carry a
-- BEFORE DELETE trigger (public.soft_delete_row()) that turns DELETE into
-- UPDATE is_deleted = TRUE for every role except root_service. Superusers can
-- assume any role without its password; if already connected as root_service
-- this is a no-op. Do not remove this line -- without it the script appears to
-- succeed and deletes nothing.
-- The AFTER DELETE audit trigger on lms.marketing_leads inserts a history row
-- referencing the lead it just deleted, which trips a RESTRICT FK. It is
-- re-enabled at the end of the transaction.
--
-- This has to happen BEFORE the SET ROLE below: ALTER TABLE requires table
-- ownership, and root_service is BYPASSRLS but does not own these tables. That
-- ownership split is the whole reason the old teardown was three files
-- (12a as the superuser, 12b as root_service, 12c as the superuser again);
-- ordering the statements correctly collapses them into one.
ALTER TABLE lms.marketing_leads DISABLE TRIGGER trg_marketing_leads_audit;

SET ROLE root_service;


-- ============================================================
-- Target scope
-- ============================================================
CREATE TEMP TABLE _t (id UUID) ON COMMIT DROP;

DO $scope$
BEGIN
  IF to_regclass('public._dummy_data_tenants') IS NOT NULL THEN
    INSERT INTO _t SELECT tenant_id FROM public._dummy_data_tenants;
  END IF;
  -- Fallback for data seeded before the registry existed.
  IF NOT EXISTS (SELECT 1 FROM _t) THEN
    INSERT INTO _t (id) VALUES
      ('a1000000-0000-0000-0000-000000000001'),   -- FitClass
      ('a3000000-0000-0000-0000-000000000001');   -- MSquare Professionals
  END IF;
END $scope$;

CREATE TEMP TABLE _o (id UUID) ON COMMIT DROP;
INSERT INTO _o SELECT id FROM entity.organizations WHERE tenant_id IN (SELECT id FROM _t);

CREATE TEMP TABLE _u (id UUID) ON COMMIT DROP;
INSERT INTO _u SELECT id FROM iam.users WHERE org_id IN (SELECT id FROM _o);

CREATE TEMP TABLE _l (id UUID) ON COMMIT DROP;
INSERT INTO _l SELECT id FROM lms.marketing_leads WHERE org_id IN (SELECT id FROM _o);

CREATE TEMP TABLE _ml (id UUID) ON COMMIT DROP;
INSERT INTO _ml SELECT id FROM ext.meta_leads WHERE org_id IN (SELECT id FROM _o);


-- ============================================================
-- 1. Meta / external integration
-- ============================================================
DELETE FROM ext.meta_capi_outbound_logs   WHERE org_id IN (SELECT id FROM _o);
DELETE FROM ext.meta_lead_addresses       WHERE meta_lead_id IN (SELECT id FROM _ml);
DELETE FROM ext.meta_lead_professional    WHERE meta_lead_id IN (SELECT id FROM _ml);
DELETE FROM ext.meta_lead_demographics    WHERE meta_lead_id IN (SELECT id FROM _ml);
DELETE FROM ext.meta_lead_custom_fields   WHERE meta_lead_id IN (SELECT id FROM _ml);
DELETE FROM ext.meta_leads                WHERE id        IN (SELECT id FROM _ml);
DELETE FROM ext.meta_page_form_org_map    WHERE org_id    IN (SELECT id FROM _o);
DELETE FROM ext.meta_forms                WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM ext.meta_tenant_config        WHERE tenant_id IN (SELECT id FROM _t);

-- ============================================================
-- 2. Audit -- lead history only
--
-- The rest of the audit sweep is deliberately LAST (step 11): the tables
-- below carry AFTER UPDATE/DELETE audit triggers, so every DELETE in this
-- script writes new audit rows as it runs. Clearing audit.audit_log here
-- would leave ~17k rows generated by the cleanup itself behind.
--
-- marketing_leads_history is the exception and has to go now: it holds a
-- RESTRICT FK to lms.marketing_leads, so the leads cannot be deleted while
-- its rows still point at them.
-- ============================================================
DELETE FROM audit.marketing_leads_history WHERE lead_id IN (SELECT id FROM _l);

-- ============================================================
-- 3. LMS
-- ============================================================
DELETE FROM lms.lead_status_log      WHERE lead_id IN (SELECT id FROM _l);
DELETE FROM lms.lead_assignment_log  WHERE lead_id IN (SELECT id FROM _l);
DELETE FROM lms.lead_follow_ups      WHERE lead_id IN (SELECT id FROM _l)
                                        OR assigned_user_id IN (SELECT id FROM _u);
DELETE FROM lms.lead_interactions    WHERE lead_id IN (SELECT id FROM _l)
                                        OR user_id  IN (SELECT id FROM _u);
DELETE FROM lms.lead_links           WHERE source_org_id IN (SELECT id FROM _o)
                                        OR dest_org_id   IN (SELECT id FROM _o);
DELETE FROM lms.marketing_leads      WHERE id      IN (SELECT id FROM _l);

-- ============================================================
-- 4. Tasks
-- ============================================================
DELETE FROM task.task_comments   WHERE task_id IN (SELECT id FROM task.tasks WHERE org_id IN (SELECT id FROM _o));
DELETE FROM task.task_status_log WHERE task_id IN (SELECT id FROM task.tasks WHERE org_id IN (SELECT id FROM _o));
DELETE FROM task.tasks           WHERE org_id  IN (SELECT id FROM _o);
DELETE FROM task.task_lists      WHERE org_id  IN (SELECT id FROM _o);

-- ============================================================
-- 5. HR
-- ============================================================
DELETE FROM hr.attendance_regularizations  WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.attendance_days             WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.attendance_events           WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.shift_assignments           WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.shift_segments              WHERE shift_id IN (SELECT id FROM hr.shifts WHERE org_id IN (SELECT id FROM _o));
DELETE FROM hr.shifts                      WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.attendance_rules            WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.leave_request_approvals     WHERE leave_request_id IN (SELECT id FROM hr.leave_requests WHERE org_id IN (SELECT id FROM _o));
DELETE FROM hr.leave_request_status_log    WHERE request_id IN (SELECT id FROM hr.leave_requests WHERE org_id IN (SELECT id FROM _o));
DELETE FROM hr.leave_ledger                WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.leave_requests              WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.leave_policies              WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.holidays                    WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.holiday_calendars           WHERE org_id IN (SELECT id FROM _o);
DELETE FROM hr.hr_settings                 WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.reporting_lines             WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.employee_profiles           WHERE tenant_id IN (SELECT id FROM _t);

-- ============================================================
-- 6. Per-product RBAC, campaigns, API clients
-- ============================================================
DELETE FROM lms.member_roles      WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.member_roles       WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM task.member_roles     WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM marketing.ad_campaigns WHERE org_id   IN (SELECT id FROM _o);
DELETE FROM iam.api_client_orgs    WHERE org_id   IN (SELECT id FROM _o);

-- ============================================================
-- 7. Users
-- ============================================================
DELETE FROM iam.token_blocklist   WHERE user_id IN (SELECT id FROM _u);
DELETE FROM iam.user_org_mapping  WHERE user_id IN (SELECT id FROM _u)
                                     OR org_id  IN (SELECT id FROM _o);
DELETE FROM iam.users             WHERE id      IN (SELECT id FROM _u);

-- ============================================================
-- 8. Tenant RBAC -- ORDER IS LOAD-BEARING
--
-- iam.user_roles.department_id is ON DELETE RESTRICT while
-- iam.departments.tenant_id is ON DELETE CASCADE. Deleting the tenant first
-- makes the cascade try to remove departments that roles still reference, and
-- the RESTRICT aborts the transaction. Grants, then roles, then departments.
-- ============================================================
DELETE FROM iam.role_capabilities WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM iam.user_roles        WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM iam.departments       WHERE tenant_id IN (SELECT id FROM _t);

-- ============================================================
-- 9. Per-tenant catalogs
--
-- The old teardown missed all of this. Left behind, the rows kept the
-- tenant_catalog_versions record alive, so re-seeding skipped every catalog
-- as "already provisioned" and the new tenants came up empty.
--
-- Stages last among the LMS tables: outcomes and the CAPI map key on stage_id.
-- ============================================================
DELETE FROM ext.lead_stage_capi_event_map
  WHERE stage_id IN (SELECT id FROM lms.lead_stage WHERE tenant_id IN (SELECT id FROM _t));
DELETE FROM lms.lead_stage_outcome   WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM lms.lead_stage           WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM lms.interaction_types    WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM lms.follow_up_statuses   WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM lms.lead_sources         WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM comms.message_templates  WHERE tenant_id IN (SELECT id FROM _t);

DELETE FROM lms.roles                WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.roles                 WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM task.roles               WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM task.task_statuses       WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM task.task_priorities     WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.leave_types           WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.employment_types      WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.attendance_statuses   WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM hr.designations          WHERE org_id    IN (SELECT id FROM _o);

DELETE FROM entity.tenant_catalog_versions WHERE tenant_id IN (SELECT id FROM _t);
DELETE FROM entity.tenant_modules          WHERE tenant_id IN (SELECT id FROM _t);

-- ============================================================
-- 10. The tenants themselves
-- ============================================================
DELETE FROM entity.organizations WHERE id IN (SELECT id FROM _o);
DELETE FROM entity.tenants       WHERE id IN (SELECT id FROM _t);


-- ============================================================
-- 11. Audit sweep -- must be the LAST delete
--
-- Every statement above fires AFTER UPDATE/DELETE audit triggers that write
-- into audit.audit_log and audit.activities, so roughly 17k rows describing
-- this cleanup exist by the time we get here. Sweeping at the end removes
-- both the demo tenants' original audit trail and the trail the teardown
-- just generated; doing it earlier (as the old 12b did) left the latter
-- behind and the database never came back to its pre-seed state.
-- ============================================================
DELETE FROM audit.marketing_leads_history WHERE lead_id IN (SELECT id FROM _l);
DELETE FROM audit.activities              WHERE org_id  IN (SELECT id FROM _o)
                                             OR performed_by IN (SELECT id FROM _u);
DELETE FROM audit.audit_log               WHERE org_id  IN (SELECT id FROM _o)
                                             OR changed_by IN (SELECT id FROM _u);

-- ============================================================
-- 12. Verify -- fail loudly rather than leave a half-cleaned database
-- ============================================================
DO $verify$
DECLARE
  n    INT;
  bad  TEXT := '';
BEGIN
  SELECT count(*) INTO n FROM entity.tenants       WHERE id IN (SELECT id FROM _t);
  IF n > 0 THEN bad := bad || format('  entity.tenants: %s rows remain%s', n, E'\n'); END IF;

  SELECT count(*) INTO n FROM entity.organizations WHERE tenant_id IN (SELECT id FROM _t);
  IF n > 0 THEN bad := bad || format('  entity.organizations: %s rows remain%s', n, E'\n'); END IF;

  SELECT count(*) INTO n FROM iam.user_roles       WHERE tenant_id IN (SELECT id FROM _t);
  IF n > 0 THEN bad := bad || format('  iam.user_roles: %s rows remain%s', n, E'\n'); END IF;

  SELECT count(*) INTO n FROM lms.lead_stage       WHERE tenant_id IN (SELECT id FROM _t);
  IF n > 0 THEN bad := bad || format('  lms.lead_stage: %s rows remain%s', n, E'\n'); END IF;

  SELECT count(*) INTO n FROM entity.tenant_catalog_versions WHERE tenant_id IN (SELECT id FROM _t);
  IF n > 0 THEN bad := bad || format('  entity.tenant_catalog_versions: %s rows remain%s', n, E'\n'); END IF;

  -- Catches the audit trail generated by the cleanup itself, which is why
  -- the audit sweep has to be the last delete rather than an early one.
  SELECT count(*) INTO n FROM audit.audit_log
    WHERE org_id IN (SELECT id FROM _o) OR changed_by IN (SELECT id FROM _u);
  IF n > 0 THEN bad := bad || format('  audit.audit_log: %s rows remain%s', n, E'\n'); END IF;

  IF bad <> '' THEN
    RAISE EXCEPTION E'dummy-data cleanup incomplete:\n%', bad;
  END IF;

  -- The templates must survive: they are reference data, not demo data.
  SELECT count(*) INTO n FROM lms.lead_stage WHERE tenant_id IS NULL;
  IF n = 0 THEN
    RAISE EXCEPTION 'cleanup removed the global lead_stage templates - reference data must survive';
  END IF;
  SELECT count(*) INTO n FROM iam.user_roles WHERE tenant_id IS NULL;
  IF n = 0 THEN
    RAISE EXCEPTION 'cleanup removed the global role templates - reference data must survive';
  END IF;

  RAISE NOTICE 'dummy data removed; reference data intact';
END $verify$;

-- Back to the invoking (owning) role: the statements below all need
-- ownership, which root_service does not have.
RESET ROLE;

-- Seed helpers and the registry, now that nothing else needs them.
DROP FUNCTION IF EXISTS _seed_uuid(INT, INT);
DROP TABLE    IF EXISTS public._dummy_data_tenants;

ALTER TABLE lms.marketing_leads ENABLE TRIGGER trg_marketing_leads_audit;

COMMIT;
