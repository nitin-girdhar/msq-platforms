-- ===================================================================
-- 10_tenant_provisioning.sql
--
-- The tenant provisioning API: everything a newly created tenant needs
-- before anyone can log into it.
--
-- WHY THIS FILE EXISTS
--
-- Reference data comes in two shapes. Some of it is genuinely global —
-- countries, the capability tree, plan types — and is seeded once by
-- reference_data/. The rest is per-tenant: every tenant owns its own lead
-- stages, its own role ladder, its own message templates, because tenants
-- edit them independently.
--
-- The per-tenant catalogs are stored ONCE as global template rows
-- (tenant_id IS NULL) by reference_data/, and copied into a tenant by the
-- functions here. The templates are permanent and are never handed out
-- directly: tenant-scoped RLS hides tenant_id IS NULL rows from ordinary
-- users, so a tenant only ever sees its own copies.
--
-- WHAT THIS REPLACES
--
-- Previously this was done by _migrations/17, 19 and 23, which ran once at
-- the end of a deploy, cloned the globals per tenant, repointed every
-- reference, and then DELETED the global originals. That last step made a
-- production-shape deploy (no demo tenants) destructive: with no tenants to
-- clone to, they deleted the entire role ladder and all five LMS catalogs
-- and left a database with a single super_admin role and zero lead stages.
-- Their headers claimed they were "idempotent and self-guarding" with no
-- tenants; the DELETE was in fact unconditional.
--
-- Keeping the templates and provisioning per tenant removes that failure
-- mode entirely, and means adding a tenant is a single function call rather
-- than a re-run of the deploy.
--
-- ENTRY POINT
--   SELECT entity.provision_tenant('<tenant-uuid>');
-- ===================================================================

BEGIN;


-- ═══════════════════════════════════════════════════════════════════
-- 1. entity.seed_tenant_lms_catalogs — lead stages and their dependants
--
--    Order matters: lead_stage_outcome and lead_stage_capi_event_map are
--    both keyed on stage_id, so the stages have to be cloned first and the
--    children matched back through the template's name.
--
--    Idempotent: every INSERT is ON CONFLICT DO NOTHING against the
--    (tenant_id, name) uniqueness, so re-running adds only what is missing
--    and never overwrites a tenant's edits.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION entity.seed_tenant_lms_catalogs(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_rows INT := 0; v_n INT;
BEGIN
  -- Stages first: the two tables below hang off stage_id.
  INSERT INTO lms.lead_stage (tenant_id, name, label, description, sort_order,
                              followup_required, is_rejected, is_terminated, is_active)
  SELECT p_tenant_id, s.name, s.label, s.description, s.sort_order,
         s.followup_required, s.is_rejected, s.is_terminated, s.is_active
  FROM lms.lead_stage s
  WHERE s.tenant_id IS NULL
  ON CONFLICT (tenant_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Outcomes are matched to the tenant's stage by the template stage's name.
  INSERT INTO lms.lead_stage_outcome (tenant_id, stage_id, name, label, description,
                                      requires_comment, sort_order, is_active)
  SELECT p_tenant_id, ts.id, o.name, o.label, o.description,
         o.requires_comment, o.sort_order, o.is_active
  FROM lms.lead_stage_outcome o
  JOIN lms.lead_stage gs ON gs.id = o.stage_id AND gs.tenant_id IS NULL
  JOIN lms.lead_stage ts ON ts.tenant_id = p_tenant_id AND ts.name = gs.name
  WHERE o.tenant_id IS NULL
  ON CONFLICT (stage_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO lms.interaction_types (tenant_id, name, label, description, is_active)
  SELECT p_tenant_id, t.name, t.label, t.description, t.is_active
  FROM lms.interaction_types t WHERE t.tenant_id IS NULL
  ON CONFLICT (tenant_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO lms.follow_up_statuses (tenant_id, name, label, description, is_active)
  SELECT p_tenant_id, t.name, t.label, t.description, t.is_active
  FROM lms.follow_up_statuses t WHERE t.tenant_id IS NULL
  ON CONFLICT (tenant_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO lms.lead_sources (tenant_id, name, label, is_active)
  SELECT p_tenant_id, t.name, t.label, t.is_active
  FROM lms.lead_sources t WHERE t.tenant_id IS NULL
  ON CONFLICT (tenant_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- The two marketing catalogs. These were tenant-scoped and RLS'd with the
  -- five above (08_rls.sql seeds all seven from one loop) but were never
  -- added here — so every tenant had a policy filtering rows that had never
  -- been cloned to them, and the platform/status dropdowns came back empty.
  INSERT INTO marketing.marketing_platforms (tenant_id, name, label, description, is_active)
  SELECT p_tenant_id, t.name, t.label, t.description, t.is_active
  FROM marketing.marketing_platforms t WHERE t.tenant_id IS NULL
  ON CONFLICT (tenant_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO marketing.campaign_statuses (tenant_id, name, label, description, is_active)
  SELECT p_tenant_id, t.name, t.label, t.description, t.is_active
  FROM marketing.campaign_statuses t WHERE t.tenant_id IS NULL
  ON CONFLICT (tenant_id, name) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Meta CAPI mapping: one row per tenant stage, copied from the mapping on
  -- the template stage of the same name. capi_event_types stay global.
  INSERT INTO ext.lead_stage_capi_event_map (tenant_id, stage_id, capi_event_type_id)
  SELECT p_tenant_id, ts.id, m.capi_event_type_id
  FROM ext.lead_stage_capi_event_map m
  JOIN lms.lead_stage gs ON gs.id = m.stage_id AND gs.tenant_id IS NULL
  JOIN lms.lead_stage ts ON ts.tenant_id = p_tenant_id AND ts.name = gs.name
  WHERE m.tenant_id IS NULL
  ON CONFLICT (stage_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  RETURN v_rows;
END; $$;


-- ═══════════════════════════════════════════════════════════════════
-- 2. entity.seed_tenant_rbac — departments, the role ladder, and grants
--
--    super_admin is deliberately NOT cloned. It is the one role that acts
--    across tenants by design, so there is no single tenant its row could
--    belong to; it stays global and is the only role that does.
--
--    Roles are cloned before their capability grants, and grants are matched
--    back to the template role by NAME. Both iam.set_user_platform_role()
--    and the gateway's PG-role selection key on the role name rather than
--    its id, so a per-tenant copy behaves identically to the template.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION entity.seed_tenant_rbac(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_rows INT := 0; v_n INT;
BEGIN
  -- The departments a tenant starts with.
  INSERT INTO iam.departments (tenant_id, org_id, name, label, description)
  VALUES
    (p_tenant_id, NULL, 'sales',      'Sales',      'Lead generation and conversion'),
    (p_tenant_id, NULL, 'operations', 'Operations', 'Day-to-day service delivery'),
    (p_tenant_id, NULL, 'hr',         'HR',         'People, attendance and leave'),
    (p_tenant_id, NULL, 'admin',      'Admin',      'Tenant administration')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO iam.user_roles (tenant_id, department_id, name, label, description, rank, is_active)
  SELECT p_tenant_id, NULL, r.name, r.label, r.description, r.rank, r.is_active
  FROM iam.user_roles r
  WHERE r.tenant_id IS NULL AND r.name <> 'super_admin'
  ON CONFLICT (tenant_id, name) WHERE tenant_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Copy each template role's platform-default grants onto the tenant's copy.
  -- is_granted is carried across so an explicit deny stays a deny.
  INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
  SELECT p_tenant_id, tr.id, rc.capability_id, rc.is_granted
  FROM iam.role_capabilities rc
  JOIN iam.user_roles gr ON gr.id = rc.role_id AND gr.tenant_id IS NULL
  JOIN iam.user_roles tr ON tr.tenant_id = p_tenant_id AND tr.name = gr.name
  WHERE rc.tenant_id IS NULL
  ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  RETURN v_rows;
END; $$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. entity.seed_tenant_comms_templates
--
--    Copied per tenant rather than shared, because a WhatsApp template
--    names a provider-approved template id that belongs to one business.
--    Two tenants messaging their own customers must not share one row.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION entity.seed_tenant_comms_templates(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_rows INT;
BEGIN
  INSERT INTO comms.message_templates (
    tenant_id, org_id, module, channel, name, label, description,
    provider_template_name, language_code, subject, body_template,
    preview_text, header_fields, body_fields, sort_order, is_active)
  SELECT p_tenant_id, NULL, t.module, t.channel, t.name, t.label, t.description,
         t.provider_template_name, t.language_code, t.subject, t.body_template,
         t.preview_text, t.header_fields, t.body_fields, t.sort_order, t.is_active
  FROM comms.message_templates t
  WHERE t.tenant_id IS NULL AND t.org_id IS NULL AND NOT t.is_deleted
  ON CONFLICT (tenant_id, org_id, module, channel, name) WHERE NOT is_deleted DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END; $$;


-- ═══════════════════════════════════════════════════════════════════
-- 3b. entity.seed_tenant_geo — countries, states and cities
--
--    geo.* used to be global. It is now a tenant catalog (a tenant curates
--    the places it actually operates in, and can add its own), so the
--    template rows seeded by reference_data/01_geo.sql have to be cloned
--    per tenant like the LMS catalogs above.
--
--    Order matters and the children are rejoined by NAME, not by id: the
--    tenant's copy of a country gets a fresh uuid, so a state cloned from
--    the template can only find its new parent through the template
--    country's name. Same shape as seed_tenant_lms_catalogs.
--
--    Idempotent: every INSERT is ON CONFLICT DO NOTHING against the partial
--    unique indexes in 06_indexes.sql, so re-running adds only what is
--    missing and never overwrites a tenant's edits or reactivates a place
--    the tenant has deactivated.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION entity.seed_tenant_geo(p_tenant_id UUID)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_rows INT := 0; v_n INT;
BEGIN
  INSERT INTO geo.countries (tenant_id, name, iso_code, description, is_active)
  SELECT p_tenant_id, c.name, c.iso_code, c.description, c.is_active
  FROM geo.countries c
  WHERE c.tenant_id IS NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO geo.states (tenant_id, country_id, name, code, description, is_active)
  SELECT p_tenant_id, tc.id, s.name, s.code, s.description, s.is_active
  FROM geo.states s
  JOIN geo.countries gc ON gc.id = s.country_id AND gc.tenant_id IS NULL
  JOIN geo.countries tc ON tc.tenant_id = p_tenant_id AND tc.name = gc.name
  WHERE s.tenant_id IS NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO geo.cities (tenant_id, state_id, name, description, is_active)
  SELECT p_tenant_id, ts.id, ct.name, ct.description, ct.is_active
  FROM geo.cities ct
  JOIN geo.states gs ON gs.id = ct.state_id AND gs.tenant_id IS NULL
  JOIN geo.countries gc ON gc.id = gs.country_id AND gc.tenant_id IS NULL
  JOIN geo.countries tc ON tc.tenant_id = p_tenant_id AND tc.name = gc.name
  JOIN geo.states ts ON ts.tenant_id = p_tenant_id AND ts.country_id = tc.id AND ts.name = gs.name
  WHERE ct.tenant_id IS NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  RETURN v_rows;
END; $$;


-- ═══════════════════════════════════════════════════════════════════
-- 4. entity.provision_tenant — the single entry point
--
--    Entitlements first: entity.seed_tenant_defaults() only seeds catalogs
--    whose gating modules overlap the tenant's ACTIVE modules, so the
--    tenant_modules rows have to exist before it runs or it seeds nothing.
--
--    p_modules defaults to all four products. Pass a narrower array to
--    provision a tenant licensed for only some of them.
--
--    Idempotent: safe to call again on an existing tenant. Every step
--    either skips already-provisioned catalogs or is ON CONFLICT DO NOTHING.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION entity.provision_tenant(
  p_tenant_id UUID,
  p_modules   TEXT[] DEFAULT ARRAY['lms', 'leave', 'attendance', 'tasks']
) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_catalogs INT := 0;
  v_geo      INT;
  v_lms      INT;
  v_rbac     INT;
  v_comms    INT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'provision_tenant: tenant id is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM entity.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'provision_tenant: tenant % not found', p_tenant_id;
  END IF;

  INSERT INTO entity.tenant_modules (tenant_id, module, is_active)
  SELECT p_tenant_id, m, TRUE FROM unnest(p_modules) AS m
  ON CONFLICT (tenant_id, module) DO UPDATE SET is_active = TRUE;

  -- The eight registry-driven catalogs (task statuses/priorities, HR leave
  -- types, employment types, attendance statuses, per-product roles).
  SELECT COALESCE(SUM(rows_inserted), 0) INTO v_catalogs
  FROM entity.seed_tenant_defaults(p_tenant_id);

  -- Geography before everything else that could reference a place.
  v_geo   := entity.seed_tenant_geo(p_tenant_id);
  v_lms   := entity.seed_tenant_lms_catalogs(p_tenant_id);
  v_rbac  := entity.seed_tenant_rbac(p_tenant_id);
  v_comms := entity.seed_tenant_comms_templates(p_tenant_id);

  RETURN format('tenant %s provisioned: %s catalog rows, %s geo rows, %s lms rows, %s rbac rows, %s comms templates',
                p_tenant_id, v_catalogs, v_geo, v_lms, v_rbac, v_comms);
END; $$;


-- ═══════════════════════════════════════════════════════════════════
-- 5. Function privileges
--    Provisioning writes across iam/lms/comms/entity, so it is a
--    root_service operation. app_user must not be able to mint roles.
-- ═══════════════════════════════════════════════════════════════════
REVOKE ALL ON FUNCTION entity.seed_tenant_geo(UUID)             FROM PUBLIC;
REVOKE ALL ON FUNCTION entity.seed_tenant_lms_catalogs(UUID)    FROM PUBLIC;
REVOKE ALL ON FUNCTION entity.seed_tenant_rbac(UUID)            FROM PUBLIC;
REVOKE ALL ON FUNCTION entity.seed_tenant_comms_templates(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION entity.provision_tenant(UUID, TEXT[])    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION entity.seed_tenant_geo(UUID)             TO root_service;
GRANT EXECUTE ON FUNCTION entity.seed_tenant_lms_catalogs(UUID)    TO root_service;
GRANT EXECUTE ON FUNCTION entity.seed_tenant_rbac(UUID)            TO root_service;
GRANT EXECUTE ON FUNCTION entity.seed_tenant_comms_templates(UUID) TO root_service;
GRANT EXECUTE ON FUNCTION entity.provision_tenant(UUID, TEXT[])    TO root_service;

COMMIT;
