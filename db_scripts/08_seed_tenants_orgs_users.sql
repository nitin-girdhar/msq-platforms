--rollback
-- ===================================================================
-- CRM Monorepo — Bulk Demo Seed: STEP 2
-- Tenants + Organizations + Users (full role hierarchy)
--
-- Run AFTER: init-db.sql, init-seed.sql
-- Run BEFORE: seed-03-leads-bulk.sql
--
-- Adds:
--   - 1 new tenant: MSquare Professionals (professional services)
--   - 8 new orgs (org_seq 3-10): 3 more FitClass + 5 MSquare
--     (combined with the 2 existing FitClass orgs from init-seed.sql,
--      this gives 5 FitClass orgs + 5 MSquare orgs = 10 total)
--   - 8 iam.users per NEW org: org_admin, org_sr_manager, org_manager,
--     senior_sales_executive, sales_representative x3, read_only
--   - 2 marketing.ad_campaigns per NEW org
--
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE throughout.
-- All demo accounts password: Admin@12345
-- ===================================================================

SET client_encoding = 'UTF8';
BEGIN;

-- ============================================================
-- Helper: build a deterministic, valid UUID from (org_seq, slot).
-- Produces e.g. org_seq=3, slot=1 -> 00000003-0000-0000-0001-000000000000
-- This avoids hand-typed/concatenated UUID literals that can silently
-- end up with the wrong number of hex digits.
-- ============================================================
CREATE OR REPLACE FUNCTION _seed_uuid(p_seq INT, p_slot INT) RETURNS UUID
LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    LPAD(p_seq::TEXT, 8, '0') || '-0000-0000-' ||
    LPAD(p_slot::TEXT, 4, '0') || '-000000000000'
  )::UUID;
$$;

-- ============================================================
-- TENANTS
-- ============================================================
INSERT INTO entity.tenants (id, name, domain_id, plan_type_id, metadata, is_active)
VALUES
    (
        'a1000000-0000-0000-0000-000000000001',
        'FitClass',
        (SELECT id FROM entity.tenant_domains    WHERE name = 'fitness'),
        (SELECT id FROM entity.tenant_plan_types WHERE name = 'growth'),
        '{"brand_color":"#E84B1A","whatsapp_number":"+91-9810001001","features":{"ai_lead_scoring":true,"bulk_sms":true}}',
        TRUE
    ),
    (
        'a3000000-0000-0000-0000-000000000001',
        'MSquare Professionals',
        (SELECT id FROM entity.tenant_domains    WHERE name = 'hospitality'),
        (SELECT id FROM entity.tenant_plan_types WHERE name = 'enterprise'),
        '{"brand_color":"#1F4E79","features":{"ai_lead_scoring":true,"bulk_sms":true}}',
        TRUE
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Config table driving org + user generation.
-- org_seq 1-2 = FitClass orgs using literal UUIDs (for script 03 compatibility).
-- org_seq 3-10 = new orgs using _seed_uuid(seq, 0) pattern.
-- ============================================================
CREATE TEMP TABLE _org_config (
  org_seq      INT PRIMARY KEY,
  org_uuid     UUID NOT NULL,
  tenant_uuid  UUID NOT NULL,
  org_name     TEXT NOT NULL,
  org_type     TEXT NOT NULL,
  city_name    TEXT NOT NULL,
  state_name   TEXT NOT NULL,
  email_domain TEXT NOT NULL,
  address1     TEXT NOT NULL,
  landmark     TEXT NOT NULL,
  pincode      TEXT NOT NULL,
  tenant_label TEXT NOT NULL  -- 'fitclass' or 'msq' — used by later scripts for domain-specific data
) ON COMMIT DROP;

-- NOTE on slot numbering within _seed_uuid(org_seq, slot):
--   slot 0       = the organization's own id
--   slots 1-8    = iam.users (1 admin, 2 sr_manager, 3 manager, 4 sse, 5-7 reps, 8 read_only)
--   slots 101-102 = marketing.ad_campaigns
-- Keeping these disjoint avoids any collision between an org row and its iam.users.
INSERT INTO _org_config
  (org_seq, org_uuid, tenant_uuid, org_name, org_type, city_name, state_name, email_domain, address1, landmark, pincode, tenant_label)
VALUES
  -- ── Existing FitClass orgs (org_seq 1-2 use literal UUIDs so script 03 can reference them) ──
  (1, 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'FitClass - Connaught Place', 'gym_location', 'Connaught Place', 'Delhi',  'fitclass.cp.in',  'A-12, Barakhamba Road',            'Near Statesman House',   '110001', 'fitclass'),
  (2, 'b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'FitClass - Saket',          'gym_location', 'Saket',           'Delhi',  'fitclass.skt.in', 'Shop 14, MGF Metropolitan Mall',   'Near Select Citywalk',   '110017', 'fitclass'),
  -- ── New FitClass orgs ──
  (3, _seed_uuid(3,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurgaon', 'gym_location', 'Gurgaon', 'Haryana',       'fitclass.ggn.in', 'Tower 3, Cyber Hub',          'Near DLF Cyber City',    '122002', 'fitclass'),
  (4, _seed_uuid(4,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Noida',   'gym_location', 'Noida',   'Uttar Pradesh', 'fitclass.noi.in', 'Sector 18 Atta Market',       'Near DLF Mall of India', '201301', 'fitclass'),
  (5, _seed_uuid(5,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Rohini',  'gym_location', 'Rohini',  'Delhi',         'fitclass.roh.in', 'Sector 7 Community Centre',   'Near Rohini West Metro', '110085', 'fitclass'),
  -- ── MSquare Professionals orgs ──
  (6, _seed_uuid(6,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Gurgaon HQ', 'branch', 'Gurgaon',   'Haryana',       'msq.ggn.in', 'Tower B, Golf Course Road',   'Near Sector 54 Metro',   '122002', 'msq'),
  (7, _seed_uuid(7,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Delhi',      'branch', 'New Delhi', 'Delhi',         'msq.del.in', 'Barakhamba Road',             'Near Mandi House',       '110001', 'msq'),
  (8, _seed_uuid(8,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Noida',      'branch', 'Noida',     'Uttar Pradesh', 'msq.noi.in', 'Sector 62, Block C',          'Near Electronic City',   '201309', 'msq'),
  (9, _seed_uuid(9,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Faridabad',  'branch', 'Faridabad', 'Haryana',       'msq.fbd.in', 'Sector 16A, Mathura Road',    'Near Neelam Chowk',      '121002', 'msq'),
  (10,_seed_uuid(10,0),'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Lucknow',    'branch', 'Lucknow',   'Uttar Pradesh', 'msq.lko.in', 'Gomti Nagar, Vibhuti Khand', 'Near Riverside Mall',    '226010', 'msq');

-- ============================================================
-- ORGANIZATIONS (all 10 orgs; ON CONFLICT DO NOTHING is idempotent)
-- ============================================================
INSERT INTO entity.organizations
    (id, tenant_id, name, legal_entity_name, brand_name, org_type_id,
     address_line1, landmark, pincode,
     city_id, state_id, country_id,
     timezone, metadata, is_active)
SELECT
    oc.org_uuid,
    oc.tenant_uuid,
    oc.org_name,
    CASE WHEN oc.tenant_label = 'fitclass' THEN 'FitClass' ELSE 'MSquare Professionals' END,
    CASE WHEN oc.tenant_label = 'fitclass' THEN 'FitClass' ELSE 'MSquare' END,
    (SELECT id FROM entity.org_types WHERE name = oc.org_type),
    oc.address1, oc.landmark, oc.pincode,
    (SELECT id FROM geo.cities  WHERE name = oc.city_name),
    (SELECT id FROM geo.states  WHERE name = oc.state_name),
    (SELECT id FROM geo.countries WHERE iso_code = 'IN'),
    'Asia/Kolkata',
    CASE WHEN oc.tenant_label = 'fitclass'
         THEN jsonb_build_object('capacity', 150 + (oc.org_seq * 20), 'equipment_tier', 'standard')
         ELSE jsonb_build_object('seat_count', 60 + (oc.org_seq * 10), 'practice_areas', jsonb_build_array('advisory','compliance'))
    END,
    TRUE
FROM _org_config oc
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- USERS — 8 per org (all 10 orgs).
-- Slot numbering within _seed_uuid(org_seq, slot):
--   1 org_admin | 2 org_sr_manager | 3 org_manager | 4 senior_sales_executive
--   5/6/7 sales_representative (x3) | 8 read_only
-- ============================================================
DO $$
DECLARE
  v_org         RECORD;
  v_admin_id    UUID;
  v_srmgr_id    UUID;
  v_mgr_id      UUID;
  v_sse_id      UUID;
  v_first_names TEXT[] := ARRAY['Arun','Bina','Chetan','Deepali','Eshan','Farah','Gopal','Hema',
                                 'Imran','Jyoti','Kabir','Lata','Madhav','Nalini','Omkar','Pooja',
                                 'Qasim','Radhika','Sahil','Tanya','Uday','Varsha','Yusuf','Zara'];
  v_last_names  TEXT[] := ARRAY['Bhatt','Chawla','Dasgupta','Eapen','Ghosh','Hooda','Iyer','Jain',
                                 'Kohli','Lamba','Mathur','Nair','Oberoi','Pillai','Qureshi','Rastogi'];
  v_password_hash TEXT := '$2b$12$7Bj5154.YS5FKsl1AaDM9O8zEzQW/db5kNkP1APKT6dcIwvReJmHe';
  v_fn_idx INT;
  v_ln_idx INT;
BEGIN
  FOR v_org IN SELECT * FROM _org_config ORDER BY org_seq LOOP

    v_admin_id := _seed_uuid(v_org.org_seq, 1);
    v_srmgr_id := _seed_uuid(v_org.org_seq, 2);
    v_mgr_id   := _seed_uuid(v_org.org_seq, 3);
    v_sse_id   := _seed_uuid(v_org.org_seq, 4);

    PERFORM set_config('app.current_org_id',  v_org.org_uuid::TEXT, TRUE);
    PERFORM set_config('app.current_user_id', v_admin_id::TEXT,     TRUE);

    -- org_admin
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 0) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 0) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (
      v_admin_id, v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '001',
      'admin@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'org_admin'), NULL,
      v_password_hash, TRUE, FALSE
    )
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- org_sr_manager
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 1) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 1) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (
      v_srmgr_id, v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '004',
      'srmanager@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'org_sr_manager'), v_admin_id,
      v_password_hash, TRUE, FALSE
    )
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- org_manager
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 2) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 2) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (
      v_mgr_id, v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '005',
      'manager@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'org_manager'), v_srmgr_id,
      v_password_hash, TRUE, FALSE
    )
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- senior_sales_executive
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 3) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 3) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (
      v_sse_id, v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '006',
      'senior.exec@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'senior_sales_executive'), v_mgr_id,
      v_password_hash, TRUE, FALSE
    )
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- sales_representative x3 (slots 5, 6, 7)
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 4) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 4) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 5), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '002', 'rep1@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'sales_representative'), v_sse_id, v_password_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    v_fn_idx := 1 + ((v_org.org_seq * 7 + 5) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 5) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 6), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '003', 'rep2@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'sales_representative'), v_sse_id, v_password_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    v_fn_idx := 1 + ((v_org.org_seq * 7 + 6) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 6) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 7), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '009', 'rep3@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'sales_representative'), v_sse_id, v_password_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- read_only (slot 8)
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 7) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 7) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 8), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '007', 'viewer@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'read_only'), NULL, v_password_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- Seed iam.user_org_mapping so the lms.check_lead_fk_org_scope trigger and RLS work.
    INSERT INTO iam.user_org_mapping (user_id, org_id, role_id, granted_by, is_active)
    SELECT u.id, v_org.org_uuid, u.role_id, v_admin_id, TRUE
    FROM iam.users u
    WHERE u.id IN (
      v_admin_id, v_srmgr_id, v_mgr_id, v_sse_id,
      _seed_uuid(v_org.org_seq, 5), _seed_uuid(v_org.org_seq, 6),
      _seed_uuid(v_org.org_seq, 7), _seed_uuid(v_org.org_seq, 8)
    )
    ON CONFLICT (user_id, org_id) DO UPDATE
      SET role_id = EXCLUDED.role_id, is_active = TRUE, updated_at = CLOCK_TIMESTAMP();

  END LOOP;
END $$;

-- ============================================================
-- AD CAMPAIGNS — 2 per new org (facebook + google), using slot
-- numbers 101/102 to keep them clearly out of the user-slot range.
-- ============================================================
DO $$
DECLARE
  v_org RECORD;
  v_statuses TEXT[] := ARRAY['active','paused','completed','draft'];
BEGIN
  FOR v_org IN SELECT * FROM _org_config ORDER BY org_seq LOOP
    PERFORM set_config('app.current_org_id', v_org.org_uuid::TEXT, TRUE);
    PERFORM set_config('app.current_user_id', _seed_uuid(v_org.org_seq, 1)::TEXT, TRUE);

    INSERT INTO marketing.ad_campaigns (id, org_id, name, platform_id, status_id, budget, started_at, ended_at)
    VALUES
      (
        _seed_uuid(v_org.org_seq, 101), v_org.org_uuid,
        v_org.org_name || ' - FB Lead Gen',
        (SELECT id FROM marketing.marketing_platforms WHERE name = 'facebook'),
        (SELECT id FROM marketing.campaign_statuses WHERE name = v_statuses[1 + (v_org.org_seq % 4)]),
        15000.00 + (v_org.org_seq * 2500),
        (CURRENT_DATE - ((400 - v_org.org_seq * 10) || ' days')::INTERVAL),
        NULL
      ),
      (
        _seed_uuid(v_org.org_seq, 102), v_org.org_uuid,
        v_org.org_name || ' - Google Search',
        (SELECT id FROM marketing.marketing_platforms WHERE name = 'google'),
        (SELECT id FROM marketing.campaign_statuses WHERE name = v_statuses[1 + ((v_org.org_seq + 1) % 4)]),
        12000.00 + (v_org.org_seq * 1800),
        (CURRENT_DATE - ((350 - v_org.org_seq * 8) || ' days')::INTERVAL),
        NULL
      )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- Module entitlements for the tenants seeded above.
--
-- 03_product_schema.sql has the same INSERT, but it runs as DDL before any
-- tenant exists on a fresh install, so it is always a no-op there and every
-- freshly deployed tenant came out with zero entitlements. That empties
-- licensed_products in the login JWT, which the product apps read to decide
-- what a user may open -- so a fresh deploy produced accounts that could
-- authenticate but not enter any product.
--
-- All four modules, matching the CHECK on entity.tenant_modules: these are
-- demo tenants for local development and every product app needs to be
-- reachable. Restrict this list to model a narrower plan.
-- ============================================================
INSERT INTO entity.tenant_modules (tenant_id, module)
SELECT t.id, m.module
FROM entity.tenants t
CROSS JOIN (VALUES ('lms'), ('leave'), ('attendance'), ('tasks')) AS m(module)
ON CONFLICT (tenant_id, module) DO NOTHING;

-- ============================================================
-- Per-tenant catalogs (lms.roles, hr/task lookups, ...).
--
-- entity.seed_tenant_defaults() is documented as "the provisioning entry
-- point", but nothing in the SQL path ever calls it: there is no trigger on
-- entity.tenants, and the app only invokes it when a tenant is created through
-- the API. A tenant seeded here therefore came up with EMPTY per-tenant
-- catalogs -- most visibly lms.roles, which 13_backfill_per_product_roles.sql
-- joins against to populate <product>.member_roles. With no roles the join
-- matched nothing, member_roles stayed empty, and the gateway refused every
-- product request with "You do not have access to the LMS product".
--
-- Must run AFTER the tenant_modules insert above: the function only seeds
-- catalogs whose gating modules overlap the tenant's ACTIVE modules.
-- Idempotent -- catalogs already recorded in tenant_catalog_versions are
-- skipped, so re-running never overwrites tenant customisations.
-- ============================================================
DO $seed_catalogs$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM entity.tenants LOOP
    PERFORM entity.seed_tenant_defaults(t.id);
  END LOOP;
END $seed_catalogs$;

-- ============================================================
-- Tier C: standard tenant-wide departments for every tenant (org_id NULL).
-- Roles (iam.user_roles) can belong to a department; these are the defaults a
-- tenant starts with and can extend. Idempotent on (tenant, tenant-wide, name).
-- ============================================================
INSERT INTO iam.departments (tenant_id, org_id, name, label, description)
SELECT t.id, NULL, d.name, d.label, d.description
FROM entity.tenants t
CROSS JOIN (VALUES
  ('sales',      'Sales',           'Lead management, follow-ups, and conversions'),
  ('hr',         'Human Resources', 'Employee profiles, leave, and attendance'),
  ('operations', 'Operations',      'Day-to-day operational teams'),
  ('admin',      'Administration',  'Org and tenant administration')
) AS d(name, label, description)
ON CONFLICT (tenant_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  WHERE NOT is_deleted
  DO NOTHING;

-- ===================================================================
-- TENANT-SCOPED, DEPARTMENT-SCOPED ROLES
-- ===================================================================
-- Every role below is tenant_id NOT NULL and department_id NOT NULL — the shape
-- Tier C1 exists for. Ranks are unique per (tenant, department), so each
-- department carries its own ladder and the same rank may recur across
-- departments without collision.
--
-- The four global anchors (read_only 0, org_admin 980, tenant_admin 990,
-- super_admin 1000) stay tenant_id NULL and are shared by both tenants.

INSERT INTO iam.user_roles (tenant_id, department_id, name, label, description, rank)
SELECT t.id, d.id, r.name, r.label, r.description, r.rank
FROM entity.tenants t
JOIN iam.departments d ON d.tenant_id = t.id AND NOT d.is_deleted
JOIN (VALUES
  -- ── sales ──
  ('sales', 'sales_executive',        'Sales Executive',        'Front-line sales — works own assigned leads',                     20),
  ('sales', 'sales_senior_executive', 'Senior Sales Executive', 'Leads a pod of executives; works the unassigned queue',           40),
  ('sales', 'sales_manager',          'Sales Manager',          'Owns a branch pipeline; approves and reassigns',                  60),
  ('sales', 'sales_head',             'Head of Sales',          'Branch-wide sales authority across all pods',                     70),
  -- ── hr ──
  ('hr', 'hr_executive', 'HR Executive', 'Employee records and day-to-day HR queries',                    25),
  ('hr', 'hr_manager',   'HR Manager',   'Approves leave and attendance corrections for the branch',      60),
  ('hr', 'hr_head',      'Head of HR',   'Full HR configuration — policies, holidays, shifts, balances', 75),
  -- ── operations ──
  ('operations', 'ops_executive', 'Operations Executive', 'Day-to-day service delivery tasks',                 25),
  ('operations', 'ops_manager',   'Operations Manager',   'Coordinates delivery across a branch team',         60),
  ('operations', 'ops_head',      'Head of Operations',   'Branch-wide operational authority',                 70),
  -- ── admin ──
  ('admin', 'admin_executive', 'Admin Executive', 'Branch administration and record keeping',      25),
  ('admin', 'admin_manager',   'Admin Manager',   'Branch administration with user management',    60)
) AS r(dept, name, label, description, rank) ON r.dept = d.name
ON CONFLICT (tenant_id, name) WHERE tenant_id IS NOT NULL
DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, rank = EXCLUDED.rank;


-- ===================================================================
-- CAPABILITY GRANTS FOR THE TENANT ROLES
-- ===================================================================
-- Each tenant role inherits the grant set of the global role it mirrors, then
-- has whole tools subtracted where the department has no business there. Doing
-- it by TEMPLATE rather than by hand keeps the ladders consistent between the
-- two tenants and makes the intent legible: "sales_manager is org_manager,
-- scoped to Sales".
--
-- Note the LMS subtraction for hr/operations/admin: this is the hr_admin problem
-- generalised. On one rank ladder a department role would otherwise clear a
-- sales floor purely by seniority.

INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT tr.tenant_id, tr.id, rc.capability_id, rc.is_granted
FROM (VALUES
  ('sales_executive',        'sales_representative'),
  ('sales_senior_executive', 'senior_sales_executive'),
  ('sales_manager',          'org_manager'),
  ('sales_head',             'org_sr_manager'),
  ('hr_executive',           'sales_representative'),
  ('hr_manager',             'org_manager'),
  ('hr_head',                'hr_admin'),
  ('ops_executive',          'sales_representative'),
  ('ops_manager',            'org_manager'),
  ('ops_head',               'org_sr_manager'),
  ('admin_executive',        'sales_representative'),
  ('admin_manager',          'org_manager')
) AS tmpl(role_name, template_name)
JOIN iam.user_roles tr ON tr.name = tmpl.role_name AND tr.tenant_id IS NOT NULL
JOIN iam.user_roles gr ON gr.name = tmpl.template_name AND gr.tenant_id IS NULL
JOIN iam.role_capabilities rc ON rc.role_id = gr.id AND rc.tenant_id IS NULL
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- Non-sales departments hold no CRM at all: denying the `lms` TOOL prunes every
-- page, operation and scope beneath it in a single row.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT tr.tenant_id, tr.id, c.id, FALSE
FROM iam.user_roles tr
JOIN iam.departments d ON d.id = tr.department_id
JOIN iam.capabilities c ON c.key = 'lms'
WHERE tr.tenant_id IS NOT NULL AND d.name IN ('hr', 'operations', 'admin')
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = FALSE;

-- HR managers and heads additionally need the HR admin surface their template
-- (org_manager) does not carry.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT tr.tenant_id, tr.id, c.id, TRUE
FROM iam.user_roles tr
JOIN iam.capabilities c ON c.key = ANY (ARRAY[
  'hr.attendance.view.org','hr.leave.view.org',
  'hr.attendance.admin.rules.view','hr.attendance.admin.shifts.view',
  'hr.attendance.admin.assignments.view','hr.attendance.admin.reports.view',
  'hr.leave.admin.policies.view','hr.leave.admin.holidays.view',
  'hr.employees.manage'
])
WHERE tr.tenant_id IS NOT NULL AND tr.name IN ('hr_manager', 'hr_head')
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = TRUE;

-- Admin managers get branch user administration; ops/admin keep Tasks as their
-- primary tool.
INSERT INTO iam.role_capabilities (tenant_id, role_id, capability_id, is_granted)
SELECT tr.tenant_id, tr.id, c.id, TRUE
FROM iam.user_roles tr
JOIN iam.capabilities c ON c.key = ANY (ARRAY['admin','admin.orgs.view','admin.users.manage'])
WHERE tr.tenant_id IS NOT NULL AND tr.name = 'admin_manager'
ON CONFLICT (tenant_id, role_id, capability_id) WHERE tenant_id IS NOT NULL
DO UPDATE SET is_granted = TRUE;


-- ===================================================================
-- ONE USER PER TENANT ROLE, PLUS THE PLATFORM ANCHORS
-- ===================================================================
-- Every user below shares the dev password Admin@12345. Emails are
-- <role>@<tenant-domain> so an end-to-end run can derive them from the role name.

DO $seedusers$
DECLARE
  v_hash    TEXT := '$2b$12$7Bj5154.YS5FKsl1AaDM9O8zEzQW/db5kNkP1APKT6dcIwvReJmHe';
  v_tenant  RECORD;
  v_role    RECORD;
  v_org     UUID;
  v_domain  TEXT;
  v_admin   UUID;
  v_uid     UUID;
  v_first   TEXT[] := ARRAY['Aarav','Ishita','Rohan','Meera','Kunal','Sneha','Vikram','Priya',
                            'Nikhil','Ananya','Rahul','Divya'];
  v_last    TEXT[] := ARRAY['Sharma','Verma','Reddy','Menon','Kapoor','Sinha'];
  i INT;
BEGIN
  FOR v_tenant IN
    SELECT t.id, t.name,
           CASE WHEN t.name = 'FitClass' THEN 'fitclass.cp.in' ELSE 'msq.ggn.in' END AS domain
    FROM entity.tenants t   LOOP
    SELECT o.id INTO v_org FROM entity.organizations o
      WHERE o.tenant_id = v_tenant.id ORDER BY o.created_at, o.id LIMIT 1;
    SELECT u.id INTO v_admin FROM iam.users u
      WHERE u.org_id = v_org AND u.email LIKE 'admin@%' LIMIT 1;
    v_domain := v_tenant.domain;

    PERFORM set_config('app.current_org_id',  v_org::TEXT,   TRUE);
    PERFORM set_config('app.current_user_id', v_admin::TEXT, TRUE);

    i := 0;
    FOR v_role IN
      SELECT r.id, r.name, r.rank FROM iam.user_roles r
      WHERE r.tenant_id = v_tenant.id ORDER BY r.rank, r.name
    LOOP
      i := i + 1;
      v_uid := public.gen_uuidv7();
      INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email,
                             role_id, manager_id, password_hash, is_active, force_password_change)
      VALUES (v_uid, v_org,
              v_first[1 + (i % array_length(v_first,1))],
              v_last[1 + (i % array_length(v_last,1))],
              '+9199' || LPAD((abs(hashtext(v_role.name || v_tenant.name)) % 100000000)::TEXT, 8, '0'),
              v_role.name || '@' || v_domain,
              v_role.id, v_admin, v_hash, TRUE, FALSE)
      ON CONFLICT (email) DO UPDATE SET role_id = EXCLUDED.role_id, password_hash = EXCLUDED.password_hash;

      INSERT INTO iam.user_org_mapping (user_id, org_id, role_id, granted_by, is_active)
      SELECT u.id, v_org, v_role.id, v_admin, TRUE FROM iam.users u WHERE u.email = v_role.name || '@' || v_domain
      ON CONFLICT (user_id, org_id) DO UPDATE
        SET role_id = EXCLUDED.role_id, is_active = TRUE, updated_at = CLOCK_TIMESTAMP();
    END LOOP;

    -- tenant_admin: a global anchor role, one holder per tenant
    v_uid := public.gen_uuidv7();
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email,
                           role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (v_uid, v_org, 'Tenant', 'Admin',
            '+9199' || LPAD((abs(hashtext('ta' || v_tenant.name)) % 100000000)::TEXT, 8, '0'),
            'tenant.admin@' || v_domain,
            (SELECT id FROM iam.user_roles WHERE name = 'tenant_admin' AND tenant_id IS NULL),
            NULL, v_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET role_id = EXCLUDED.role_id, password_hash = EXCLUDED.password_hash;

    INSERT INTO iam.user_org_mapping (user_id, org_id, role_id, granted_by, is_active)
    SELECT u.id, v_org, u.role_id, v_admin, TRUE FROM iam.users u WHERE u.email = 'tenant.admin@' || v_domain
    ON CONFLICT (user_id, org_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = TRUE;
  END LOOP;

  -- super_admin: platform-wide, homed in FitClass's first branch
  SELECT o.id INTO v_org FROM entity.organizations o
    JOIN entity.tenants t ON t.id = o.tenant_id AND t.name = 'FitClass'
    ORDER BY o.created_at, o.id LIMIT 1;
  SELECT u.id INTO v_admin FROM iam.users u WHERE u.org_id = v_org AND u.email LIKE 'admin@%' LIMIT 1;
  PERFORM set_config('app.current_org_id', v_org::TEXT, TRUE);
  PERFORM set_config('app.current_user_id', v_admin::TEXT, TRUE);

  INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email,
                         role_id, manager_id, password_hash, is_active, force_password_change)
  VALUES (public.gen_uuidv7(), v_org, 'Super', 'Admin', '+919900000001', 'super.admin@msquare.io',
          (SELECT id FROM iam.user_roles WHERE name = 'super_admin' AND tenant_id IS NULL),
          NULL, v_hash, TRUE, FALSE)
  ON CONFLICT (email) DO UPDATE SET role_id = EXCLUDED.role_id, password_hash = EXCLUDED.password_hash;

  INSERT INTO iam.user_org_mapping (user_id, org_id, role_id, granted_by, is_active)
  SELECT u.id, v_org, u.role_id, v_admin, TRUE FROM iam.users u WHERE u.email = 'super.admin@msquare.io'
  ON CONFLICT (user_id, org_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = TRUE;
END $seedusers$;

-- Both tenants licensed for every module, so entitlement never masks a
-- capability result during end-to-end validation.
INSERT INTO entity.tenant_modules (tenant_id, module)
SELECT t.id, m.module
FROM entity.tenants t
CROSS JOIN (VALUES ('lms'), ('tasks'), ('attendance'), ('leave')) AS m(module)
ON CONFLICT (tenant_id, module) DO UPDATE SET is_active = TRUE;

COMMIT;

-- ============================================================
-- Sanity check (run manually after this script if you want to verify)
-- ============================================================
-- SELECT t.name AS tenant, COUNT(DISTINCT o.id) AS orgs, COUNT(DISTINCT u.id) AS iam.users
-- FROM entity.tenants t
-- JOIN entity.organizations o ON o.tenant_id = t.id
-- LEFT JOIN iam.users u ON u.org_id = o.id
-- GROUP BY t.name;
