-- ===================================================================
-- reference_data/01_geo.sql — Geography
--
-- Countries, states and cities.
--
-- These are TEMPLATE rows (tenant_id IS NULL), not global shared data. RLS
-- (08_rls.sql) hides them from every application role; entity.seed_tenant_geo()
-- clones them into a tenant at provisioning time, and the tenant then owns
-- and edits its copies. Same pattern as the LMS catalogs and the role ladder
-- — see the header of 10_tenant_provisioning.sql.
--
-- Keep this list SMALL. Every row here is duplicated into every tenant, so
-- it is a starting point, not a geography dataset. Tenants add the places
-- they actually operate in through lookup-admin.
--
-- Reference data: required by every deployment, demo or production.
-- Idempotent (ON CONFLICT), so re-running is safe.
-- ===================================================================

BEGIN;

-- ===================================================================
-- GEOGRAPHIC DATA
-- ===================================================================

-- ── Geographic template rows ────────────────────────────────────────
-- tenant_id is left NULL on every row: that is what marks them templates.
-- The ON CONFLICT targets name the partial indexes' predicates
-- (WHERE tenant_id IS NULL) so inference picks the template index and not
-- the per-tenant one — see 06_indexes.sql.
INSERT INTO geo.countries (tenant_id, name, iso_code) VALUES
  (NULL, 'India',                'IN'),
  (NULL, 'United States',        'US'),
  (NULL, 'United Kingdom',       'GB'),
  (NULL, 'United Arab Emirates', 'AE')
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

INSERT INTO geo.states (tenant_id, country_id, name, code)
SELECT NULL, c.id, s.name, s.code
FROM geo.countries c
CROSS JOIN (VALUES
  ('Delhi',           'DL'),
  ('Maharashtra',     'MH'),
  ('Karnataka',       'KA'),
  ('Tamil Nadu',      'TN'),
  ('West Bengal',     'WB'),
  ('Telangana',       'TS'),
  ('Rajasthan',       'RJ'),
  ('Gujarat',         'GJ'),
  ('Uttar Pradesh',   'UP'),
  ('Haryana',         'HR'),
  ('Punjab',          'PB'),
  ('Madhya Pradesh',  'MP')
) AS s(name, code)
WHERE c.iso_code = 'IN' AND c.tenant_id IS NULL
ON CONFLICT (country_id, name) WHERE tenant_id IS NULL DO NOTHING;

INSERT INTO geo.cities (tenant_id, state_id, name)
SELECT NULL, s.id, c.name
FROM geo.states s
CROSS JOIN (VALUES
  ('Delhi',         'New Delhi'),
  ('Delhi',         'Dwarka'),
  ('Delhi',         'Rohini'),
  ('Delhi',         'Lajpat Nagar'),
  ('Delhi',         'Connaught Place'),
  ('Delhi',         'Saket'),
  ('Delhi',         'Janakpuri'),
  ('Uttar Pradesh', 'Lucknow'),
  ('Uttar Pradesh', 'Noida'),
  ('Uttar Pradesh', 'Agra'),
  ('Haryana',       'Gurgaon'),
  ('Haryana',       'Faridabad'),
  ('Punjab',        'Chandigarh'),
  ('Punjab',        'Amritsar')
) AS c(state_name, name)
WHERE s.name = c.state_name AND s.tenant_id IS NULL
ON CONFLICT (state_id, name) WHERE tenant_id IS NULL DO NOTHING;

COMMIT;
