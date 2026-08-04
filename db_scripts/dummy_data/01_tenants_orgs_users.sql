-- ===================================================================
-- dummy_data/01_tenants_orgs_users.sql
--
-- Demo tenants, branches, users and ad campaigns for local development.
--
-- NOT reference data: nothing here is required by a production deploy.
-- Everything a tenant genuinely needs to function is created by
-- entity.provision_tenant() (10_tenant_provisioning.sql), which this
-- script calls -- the same call the application makes for a real tenant.
--
-- Remove everything this creates with dummy_data/99_cleanup_dummy_data.sql.
-- ===================================================================

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
-- Provision every tenant seeded above.
--
-- entity.provision_tenant() does all of it in one call: module
-- entitlements, the geography catalog, the eight registry catalogs, the LMS
-- lead catalogs, departments, the role ladder with its capability grants,
-- and the message templates. See 10_tenant_provisioning.sql.
--
-- This is the ONLY thing a new tenant needs, and it is the same call the
-- application makes when a tenant is created through the API — so a demo
-- tenant and a real one are provisioned by identical code.
--
-- It runs HERE, before organizations, because geo.* is tenant-scoped and
-- entity.organizations carries a composite (tenant_id, city_id) FK: a
-- branch cannot be inserted until its tenant owns the place it sits in.
--
-- All four modules, so every product app is reachable in a dev
-- environment. Pass a narrower array to model a restricted plan.
-- ============================================================
DO $provision$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM entity.tenants ORDER BY name LOOP
    RAISE NOTICE '%', entity.provision_tenant(t.id, ARRAY['lms','leave','attendance','tasks']);
  END LOOP;
END $provision$;

-- ============================================================
-- WHERE EACH DEMO TENANT ACTUALLY OPERATES
--
-- provision_tenant() above cloned the generic template geography
-- (reference_data/01_geo.sql) into both tenants. Here we add the states and
-- cities the template does not carry, then deactivate everything each
-- tenant does NOT operate in.
--
-- Deactivate rather than delete: that is the platform's delete semantics for
-- geo (07_grants.sql grants no DELETE), and it exercises the same path
-- lookup-admin uses.
--
-- FitClass  — India: Haryana, Punjab, Delhi, Uttar Pradesh, Uttarakhand.
--             Punjab is a stated presence with no centre in it, which is
--             why it stays active with zero cities.
-- MSquare   — India: Haryana / Gurgaon only.
-- ============================================================
CREATE TEMP TABLE _tenant_geo (
  tenant_uuid UUID NOT NULL,
  state_name  TEXT NOT NULL,
  state_code  TEXT,
  city_name   TEXT              -- NULL = the state is a presence with no city
) ON COMMIT DROP;

INSERT INTO _tenant_geo (tenant_uuid, state_name, state_code, city_name) VALUES
  -- ── FitClass ──
  ('a1000000-0000-0000-0000-000000000001', 'Haryana',       'HR', 'Gurgaon'),
  ('a1000000-0000-0000-0000-000000000001', 'Haryana',       'HR', 'Rewari'),
  ('a1000000-0000-0000-0000-000000000001', 'Delhi',         'DL', 'Delhi'),
  ('a1000000-0000-0000-0000-000000000001', 'Uttar Pradesh', 'UP', 'Noida'),
  ('a1000000-0000-0000-0000-000000000001', 'Uttarakhand',   'UK', 'Dehradun'),
  ('a1000000-0000-0000-0000-000000000001', 'Punjab',        'PB', NULL),
  -- ── MSquare Professionals ──
  ('a3000000-0000-0000-0000-000000000001', 'Haryana',       'HR', 'Gurgaon');

-- States the template did not supply (Uttarakhand), under each tenant's India.
INSERT INTO geo.states (tenant_id, country_id, name, code)
SELECT DISTINCT tg.tenant_uuid, c.id, tg.state_name, tg.state_code
FROM _tenant_geo tg
JOIN geo.countries c ON c.tenant_id = tg.tenant_uuid AND c.iso_code = 'IN'
ON CONFLICT DO NOTHING;

-- Cities the template did not supply (Gurgaon exists, Rewari/Dehradun/Delhi-city do not).
INSERT INTO geo.cities (tenant_id, state_id, name)
SELECT tg.tenant_uuid, s.id, tg.city_name
FROM _tenant_geo tg
JOIN geo.states s ON s.tenant_id = tg.tenant_uuid AND s.name = tg.state_name
WHERE tg.city_name IS NOT NULL
ON CONFLICT DO NOTHING;

-- Everything else the template cloned in is not a place these tenants work in.
UPDATE geo.cities c SET is_active = FALSE
WHERE c.tenant_id IN (SELECT DISTINCT tenant_uuid FROM _tenant_geo)
  AND NOT EXISTS (
    SELECT 1 FROM _tenant_geo tg
    JOIN geo.states s ON s.id = c.state_id AND s.tenant_id = c.tenant_id
    WHERE tg.tenant_uuid = c.tenant_id
      AND tg.state_name  = s.name
      AND tg.city_name   = c.name
  );

UPDATE geo.states s SET is_active = FALSE
WHERE s.tenant_id IN (SELECT DISTINCT tenant_uuid FROM _tenant_geo)
  AND NOT EXISTS (
    SELECT 1 FROM _tenant_geo tg
    WHERE tg.tenant_uuid = s.tenant_id AND tg.state_name = s.name
  );

-- Both demo tenants are India-only.
UPDATE geo.countries SET is_active = FALSE
WHERE tenant_id IN (SELECT DISTINCT tenant_uuid FROM _tenant_geo)
  AND iso_code <> 'IN';

-- ============================================================
-- Config table driving org + user generation.
-- org_seq 1-2 = FitClass orgs using literal UUIDs (for script 03 compatibility).
-- org_seq 3-27 = new orgs using _seed_uuid(seq, 0) pattern.
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
-- The centre level. geo stops at the city (Gurgaon, Delhi, Noida, Dehradun,
-- Rewari); the individual centres — Gurugram-Sector-49, Moti-Nagar and the
-- rest — are organizations sitting in those cities. city_name/state_name
-- below are the geo row each centre points at, not the centre's own name.
INSERT INTO _org_config
  (org_seq, org_uuid, tenant_uuid, org_name, org_type, city_name, state_name, email_domain, address1, landmark, pincode, tenant_label)
VALUES
  -- ── FitClass — Gurgaon, Haryana (org_seq 1-2 keep literal UUIDs so script 03 can reference them) ──
  (1, 'b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'FitClass - Ashok Vihar',          'gym_location', 'Gurgaon', 'Haryana', 'fitclass.avr.in', 'Ashok Vihar Phase 3',        'Near Ashok Vihar Chowk',   '122001', 'fitclass'),
  (2, 'b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurugram Sector 49',   'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g49.in', 'Sector 49, Sohna Road',      'Near Uniworld Garden',     '122018', 'fitclass'),
  (3,  _seed_uuid(3,0),  'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurgaon Sector 102',  'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g102.in', 'Sector 102, Dwarka Expressway', 'Near Bajghera Road',    '122006', 'fitclass'),
  (4,  _seed_uuid(4,0),  'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurgaon Sector 104',  'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g104.in', 'Sector 104, Dwarka Expressway', 'Near Chintels Serenity','122006', 'fitclass'),
  (5,  _seed_uuid(5,0),  'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurgaon Sector 57',   'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g57.in',  'Sector 57, Sushant Lok 2',      'Near Hong Kong Bazaar', '122011', 'fitclass'),
  (6,  _seed_uuid(6,0),  'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurgaon Sector 83',   'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g83.in',  'Sector 83, New Gurgaon',        'Near Vatika India Next', '122004', 'fitclass'),
  (7,  _seed_uuid(7,0),  'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurgaon Sector 92',   'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g92.in',  'Sector 92, New Gurgaon',        'Near Sohna Road Link',  '122505', 'fitclass'),
  (8,  _seed_uuid(8,0),  'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurugram Sector 109', 'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g109.in', 'Sector 109, Dwarka Expressway', 'Near Chintels Paradiso','122017', 'fitclass'),
  (9,  _seed_uuid(9,0),  'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurugram Sector 47',  'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g47.in',  'Sector 47, Sohna Road',         'Near Subhash Chowk',    '122018', 'fitclass'),
  (10, _seed_uuid(10,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurugram Sector 82',  'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g82.in',  'Sector 82, New Gurgaon',        'Near Vatika City Centre','122004', 'fitclass'),
  (11, _seed_uuid(11,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Manesar',             'gym_location', 'Gurgaon', 'Haryana', 'fitclass.mnr.in',  'IMT Manesar Sector 8',          'Near Honda Chowk',      '122052', 'fitclass'),
  (12, _seed_uuid(12,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Palam Vihar',         'gym_location', 'Gurgaon', 'Haryana', 'fitclass.pvr.in',  'Palam Vihar Block C',           'Near Palam Vihar Chowk','122017', 'fitclass'),
  (13, _seed_uuid(13,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurugram Sector 37',  'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g37.in',  'Sector 37, Pace City',          'Near Basai Road',       '122001', 'fitclass'),
  (14, _seed_uuid(14,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Gurugram Sector 69',  'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g69.in',  'Sector 69, Golf Course Ext',    'Near Tulip Violet',     '122101', 'fitclass'),
  (15, _seed_uuid(15,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Sector 7',            'gym_location', 'Gurgaon', 'Haryana', 'fitclass.g7.in',   'Sector 7 Urban Estate',         'Near Sector 7 Market',  '122001', 'fitclass'),
  -- ── FitClass — Delhi ──
  (16, _seed_uuid(16,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Budh Vihar',   'gym_location', 'Delhi', 'Delhi', 'fitclass.bvr.in', 'Budh Vihar Phase 1',   'Near Budh Vihar Chowk',  '110086', 'fitclass'),
  (17, _seed_uuid(17,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Moti Nagar',   'gym_location', 'Delhi', 'Delhi', 'fitclass.mnr2.in','Moti Nagar Main Road',  'Near Moti Nagar Metro',  '110015', 'fitclass'),
  (18, _seed_uuid(18,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Ramesh Nagar', 'gym_location', 'Delhi', 'Delhi', 'fitclass.rnr.in', 'Ramesh Nagar Block B',  'Near Ramesh Nagar Metro','110015', 'fitclass'),
  (19, _seed_uuid(19,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Rohini',       'gym_location', 'Delhi', 'Delhi', 'fitclass.roh.in', 'Sector 7 Community Centre','Near Rohini West Metro','110085', 'fitclass'),
  -- ── FitClass — the rest ──
  (20, _seed_uuid(20,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Knowledge Park 2', 'gym_location', 'Noida',    'Uttar Pradesh', 'fitclass.kp2.in', 'Knowledge Park 2',      'Near Pari Chowk',       '201310', 'fitclass'),
  (21, _seed_uuid(21,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Dehradun',         'gym_location', 'Dehradun', 'Uttarakhand',   'fitclass.ddn.in', 'Rajpur Road',           'Near Clock Tower',      '248001', 'fitclass'),
  (22, _seed_uuid(22,0), 'a1000000-0000-0000-0000-000000000001', 'FitClass - Anaj Mandi',       'gym_location', 'Rewari',   'Haryana',       'fitclass.amd.in', 'Anaj Mandi Main Road',  'Near Rewari Bus Stand', '123401', 'fitclass'),
  -- ── MSquare Professionals — Gurgaon, Haryana only ──
  (23, _seed_uuid(23,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Gurgaon HQ',         'branch', 'Gurgaon', 'Haryana', 'msq.ggn.in', 'Tower B, Golf Course Road', 'Near Sector 54 Metro',  '122002', 'msq'),
  (24, _seed_uuid(24,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Gurgaon Cyber City', 'branch', 'Gurgaon', 'Haryana', 'msq.gcc.in', 'DLF Cyber City Phase 2',    'Near Cyber Hub',        '122002', 'msq'),
  (25, _seed_uuid(25,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Gurgaon Sector 44',  'branch', 'Gurgaon', 'Haryana', 'msq.g44.in', 'Sector 44, Huda City',      'Near Huda City Centre',  '122003', 'msq'),
  (26, _seed_uuid(26,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Gurgaon Udyog Vihar','branch', 'Gurgaon', 'Haryana', 'msq.uvr.in', 'Udyog Vihar Phase 4',       'Near Signature Tower',   '122015', 'msq'),
  (27, _seed_uuid(27,0), 'a3000000-0000-0000-0000-000000000001', 'MSquare Professionals - Gurgaon Sohna Road', 'branch', 'Gurgaon', 'Haryana', 'msq.shr.in', 'Sohna Road, Sector 48',     'Near Omaxe Gurgaon Mall','122018', 'msq');

-- ============================================================
-- ORGANIZATIONS (all 27 orgs; ON CONFLICT DO NOTHING is idempotent)
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
    -- geo.* is per-tenant now, so every tenant has its own row called
    -- "Gurgaon". Without the tenant_id filter these subqueries return more
    -- than one row and the insert fails.
    (SELECT ci.id FROM geo.cities ci
       JOIN geo.states s ON s.id = ci.state_id AND s.tenant_id = ci.tenant_id
      WHERE ci.tenant_id = oc.tenant_uuid AND ci.name = oc.city_name AND s.name = oc.state_name),
    (SELECT s.id  FROM geo.states    s WHERE s.tenant_id = oc.tenant_uuid AND s.name     = oc.state_name),
    (SELECT c.id  FROM geo.countries c WHERE c.tenant_id = oc.tenant_uuid AND c.iso_code = 'IN'),
    'Asia/Kolkata',
    CASE WHEN oc.tenant_label = 'fitclass'
         THEN jsonb_build_object('capacity', 150 + (oc.org_seq * 20), 'equipment_tier', 'standard')
         ELSE jsonb_build_object('seat_count', 60 + (oc.org_seq * 10), 'practice_areas', jsonb_build_array('advisory','compliance'))
    END,
    TRUE
FROM _org_config oc
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- USERS — 8 per org (all 27 orgs).
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
      (SELECT id FROM iam.user_roles WHERE name = 'org_admin' AND tenant_id = v_org.tenant_uuid), NULL,
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
      (SELECT id FROM iam.user_roles WHERE name = 'org_sr_manager' AND tenant_id = v_org.tenant_uuid), v_admin_id,
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
      (SELECT id FROM iam.user_roles WHERE name = 'org_manager' AND tenant_id = v_org.tenant_uuid), v_srmgr_id,
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
      (SELECT id FROM iam.user_roles WHERE name = 'senior_sales_executive' AND tenant_id = v_org.tenant_uuid), v_mgr_id,
      v_password_hash, TRUE, FALSE
    )
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- sales_representative x3 (slots 5, 6, 7)
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 4) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 4) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 5), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '002', 'rep1@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'sales_representative' AND tenant_id = v_org.tenant_uuid), v_sse_id, v_password_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    v_fn_idx := 1 + ((v_org.org_seq * 7 + 5) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 5) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 6), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '003', 'rep2@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'sales_representative' AND tenant_id = v_org.tenant_uuid), v_sse_id, v_password_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    v_fn_idx := 1 + ((v_org.org_seq * 7 + 6) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 6) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 7), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '009', 'rep3@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'sales_representative' AND tenant_id = v_org.tenant_uuid), v_sse_id, v_password_hash, TRUE, FALSE)
    ON CONFLICT (email) DO UPDATE SET mobile = EXCLUDED.mobile, manager_id = EXCLUDED.manager_id, password_hash = EXCLUDED.password_hash;

    -- read_only (slot 8)
    v_fn_idx := 1 + ((v_org.org_seq * 7 + 7) % array_length(v_first_names,1));
    v_ln_idx := 1 + ((v_org.org_seq * 5 + 7) % array_length(v_last_names,1));
    INSERT INTO iam.users (id, org_id, first_name, last_name, mobile, email, role_id, manager_id, password_hash, is_active, force_password_change)
    VALUES (_seed_uuid(v_org.org_seq, 8), v_org.org_uuid, v_first_names[v_fn_idx], v_last_names[v_ln_idx],
      '+9198110' || LPAD(v_org.org_seq::TEXT,2,'0') || '007', 'viewer@' || v_org.email_domain,
      (SELECT id FROM iam.user_roles WHERE name = 'read_only' AND tenant_id = v_org.tenant_uuid), NULL, v_password_hash, TRUE, FALSE)
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
        (SELECT id FROM marketing.marketing_platforms WHERE name = 'facebook' AND tenant_id = v_org.tenant_uuid),
        (SELECT id FROM marketing.campaign_statuses WHERE name = v_statuses[1 + (v_org.org_seq % 4)] AND tenant_id = v_org.tenant_uuid),
        15000.00 + (v_org.org_seq * 2500),
        (CURRENT_DATE - ((400 - v_org.org_seq * 10) || ' days')::INTERVAL),
        NULL
      ),
      (
        _seed_uuid(v_org.org_seq, 102), v_org.org_uuid,
        v_org.org_name || ' - Google Search',
        (SELECT id FROM marketing.marketing_platforms WHERE name = 'google' AND tenant_id = v_org.tenant_uuid),
        (SELECT id FROM marketing.campaign_statuses WHERE name = v_statuses[1 + ((v_org.org_seq + 1) % 4)] AND tenant_id = v_org.tenant_uuid),
        12000.00 + (v_org.org_seq * 1800),
        (CURRENT_DATE - ((350 - v_org.org_seq * 8) || ' days')::INTERVAL),
        NULL
      )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- ============================================================
-- Provision every tenant seeded above.
--
-- entity.provision_tenant() does all of it in one call: module
-- entitlements, the eight registry catalogs, the LMS lead catalogs,
-- departments, the role ladder with its capability grants, and the
-- message templates. See 10_tenant_provisioning.sql.
--
-- This is the ONLY thing a new tenant needs, and it is the same call the
-- application makes when a tenant is created through the API — so a demo
-- tenant and a real one are provisioned by identical code.
--
-- All four modules, so every product app is reachable in a dev
-- environment. Pass a narrower array to model a restricted plan.
-- ============================================================
-- (Moved to just after the TENANTS insert above: geo.* is tenant-scoped now,
-- and entity.organizations has a composite (tenant_id, city_id) FK, so a
-- tenant's geography has to exist before its branches can be inserted.)


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
            (SELECT id FROM iam.user_roles WHERE name = 'tenant_admin' AND tenant_id = v_tenant.id),
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


-- ============================================================
-- Record the demo tenants so the cleanup script can find them.
--
-- The old teardown hardcoded two tenant UUIDs, so adding a third demo
-- tenant here would have silently left it (and everything under it)
-- behind. Registering them makes cleanup self-maintaining.
-- ============================================================
CREATE TABLE IF NOT EXISTS public._dummy_data_tenants (
  tenant_id  UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);
COMMENT ON TABLE public._dummy_data_tenants IS
  'Tenants created by dummy_data/. Read by dummy_data/99_cleanup_dummy_data.sql. Absent in a production deploy.';

INSERT INTO public._dummy_data_tenants (tenant_id)
SELECT id FROM entity.tenants ON CONFLICT DO NOTHING;


-- ============================================================
-- Reporting lines — the real hierarchy (iam.reporting_lines)
--
-- The manager_id values set above are only the DISPLAY mirror; authority for
-- leads, leave and tasks all resolves from iam.reporting_lines. Deriving the
-- lines from them here means local dev exercises the same path production
-- does, instead of a tree that only exists in the deprecated column.
-- ============================================================
INSERT INTO iam.reporting_lines (tenant_id, org_id, user_id, manager_id, effective_from)
SELECT o.tenant_id, uom.org_id, u.id, u.manager_id, CURRENT_DATE - 90
FROM iam.users u
JOIN iam.user_org_mapping uom ON uom.user_id = u.id AND uom.is_active
JOIN entity.organizations o   ON o.id = uom.org_id
WHERE u.manager_id IS NOT NULL
  AND u.manager_id <> u.id
  AND NOT u.is_deleted
  -- the membership rule: a manager must belong to the org the line sits in
  AND EXISTS (SELECT 1 FROM iam.user_org_mapping m
               WHERE m.user_id = u.manager_id AND m.org_id = uom.org_id AND m.is_active)
  AND NOT EXISTS (SELECT 1 FROM iam.reporting_lines rl
                   WHERE rl.user_id = u.id AND rl.org_id = uom.org_id
                     AND rl.effective_to IS NULL AND NOT rl.is_deleted);

-- ── A manager shared across two branches (the Fitclass shape) ──
-- One person, mapped into a second org, managing people in both. This is the
-- ONLY supported way to span orgs, and it is seeded here so the case gets
-- exercised locally rather than first appearing in production. Picks the two
-- oldest orgs of the first tenant that has two, and the first org_admin in the
-- first of them.
WITH ranked AS (
  SELECT id, tenant_id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY id) AS rn
  FROM entity.organizations WHERE NOT is_deleted
),
pair AS (
  SELECT a.id AS org_a, b.id AS org_b
  FROM ranked a
  JOIN ranked b ON b.tenant_id = a.tenant_id AND b.rn = 2
  WHERE a.rn = 1
  ORDER BY a.tenant_id
  LIMIT 1
),
mgr AS (
  SELECT p.org_b, uom.user_id, uom.role_id
  FROM pair p
  JOIN iam.user_org_mapping uom ON uom.org_id = p.org_a AND uom.is_active
  JOIN iam.user_roles ur ON ur.id = uom.role_id AND ur.name = 'org_admin'
  ORDER BY uom.user_id
  LIMIT 1
)
INSERT INTO iam.user_org_mapping (user_id, org_id, role_id)
SELECT user_id, org_b, role_id FROM mgr
ON CONFLICT (user_id, org_id) DO UPDATE SET is_active = TRUE;

-- Now give one line-less user in that second org a line to the shared manager.
WITH shared AS (
  SELECT uom.user_id AS manager_id, uom.org_id, o.tenant_id
  FROM iam.user_org_mapping uom
  JOIN entity.organizations o ON o.id = uom.org_id
  JOIN iam.user_roles ur ON ur.id = uom.role_id AND ur.name = 'org_admin'
  WHERE uom.is_active
    AND (SELECT count(*) FROM iam.user_org_mapping x
          WHERE x.user_id = uom.user_id AND x.is_active) > 1
  ORDER BY uom.user_id, uom.org_id DESC
  LIMIT 1
)
INSERT INTO iam.reporting_lines (tenant_id, org_id, user_id, manager_id, effective_from)
SELECT s.tenant_id, s.org_id, u.user_id, s.manager_id, CURRENT_DATE - 30
FROM shared s
JOIN LATERAL (
  SELECT uom.user_id
  FROM iam.user_org_mapping uom
  JOIN iam.users usr ON usr.id = uom.user_id AND usr.is_active AND NOT usr.is_deleted
  WHERE uom.org_id = s.org_id AND uom.is_active AND uom.user_id <> s.manager_id
    AND NOT EXISTS (SELECT 1 FROM iam.reporting_lines rl
                     WHERE rl.user_id = uom.user_id AND rl.org_id = s.org_id
                       AND rl.effective_to IS NULL AND NOT rl.is_deleted)
  ORDER BY uom.user_id
  LIMIT 1
) u ON TRUE;


COMMIT;

-- ============================================================
-- Sanity check (run manually after this script if you want to verify)
-- ============================================================
-- SELECT t.name AS tenant, COUNT(DISTINCT o.id) AS orgs, COUNT(DISTINCT u.id) AS iam.users
-- FROM entity.tenants t
-- JOIN entity.organizations o ON o.tenant_id = t.id
-- LEFT JOIN iam.users u ON u.org_id = o.id
-- GROUP BY t.name;
