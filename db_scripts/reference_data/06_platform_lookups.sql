-- ===================================================================
-- reference_data/06_platform_lookups.sql — Platform lookups
--
-- Small global vocabularies with no tenant dimension: org types, tenant
-- domains and plan types, marketing platforms and campaign statuses,
-- and the HR leave-request status list.
--
-- Reference data: required by every deployment, demo or production.
-- Idempotent (ON CONFLICT), so re-running is safe.
-- ===================================================================

BEGIN;

-- ===================================================================
-- MARKETING -- PLATFORMS & CAMPAIGN STATUSES
-- ===================================================================

-- Template rows (tenant_id NULL); entity.seed_tenant_lms_catalogs() clones
-- them per tenant. The conflict target is the partial template index from
-- 06_indexes.sql -- (tenant_id, name) would not dedupe, since NULLs are distinct.
INSERT INTO marketing.marketing_platforms (tenant_id, name, label, description) VALUES
  (NULL, 'facebook',     'Facebook',     'Facebook / Instagram Lead Ads and Campaigns'),
  (NULL, 'google',       'Google',       'Google Ads (Search, Display, Shopping, Performance Max)'),
  (NULL, 'instagram',    'Instagram',    'Instagram organic and paid posts'),
  (NULL, 'youtube',      'YouTube',      'YouTube video ads'),
  (NULL, 'whatsapp',     'WhatsApp',     'WhatsApp click-to-chat ads via Facebook Ads Manager'),
  (NULL, 'linkedin',     'LinkedIn',     'LinkedIn Lead Gen Forms and sponsored content'),
  (NULL, 'tiktok',       'TikTok',       'TikTok for Business lead generation'),
  (NULL, 'organic',      'Organic',      'Walk-in, direct website, or offline enquiry with no paid source'),
  (NULL, 'referral',     'Referral',     'Referred by an existing customer or partner'),
  (NULL, 'whatsapp_ads', 'WhatsApp Ads', 'WhatsApp click-to-chat ads via Facebook Ads Manager (legacy alias)')
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

INSERT INTO marketing.campaign_statuses (tenant_id, name, label, description) VALUES
  (NULL, 'draft',     'Draft',     'Campaign created but not yet submitted for review or activation'),
  (NULL, 'active',    'Active',    'Campaign is live and currently running'),
  (NULL, 'paused',    'Paused',    'Campaign temporarily paused; can be resumed'),
  (NULL, 'completed', 'Completed', 'Campaign ran its full duration and ended normally'),
  (NULL, 'archived',  'Archived',  'Campaign permanently closed and moved to archive')
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;


-- ===================================================================
-- ENTITY -- ORG TYPES, TENANT DOMAINS, TENANT PLAN TYPES
-- ===================================================================

INSERT INTO entity.org_types (name, label, description) VALUES
  ('gym_location', 'Gym Location', 'Physical gym or fitness centre location'),
  ('boutique',     'Boutique',     'Boutique or small retail outlet'),
  ('branch',       'Branch',       'Standard branch office of a business'),
  ('headquarters', 'Headquarters', 'Corporate headquarters or registered office'),
  ('franchise',    'Franchise',    'Franchise outlet operating under a licensor brand'),
  ('clinic',       'Clinic',       'Medical or wellness clinic unit'),
  ('warehouse',    'Warehouse',    'Storage or fulfilment centre'),
  ('showroom',     'Showroom',     'Product display and sales showroom'),
  ('head_office',  'Head Office',  'Corporate headquarters or registered office (alias)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO entity.tenant_domains (name, label, description) VALUES
  ('fitness',     'Fitness',     'Gyms, fitness centres, yoga studios, personal training'),
  ('retail',      'Retail',      'Fashion boutiques, apparel, accessories, lifestyle stores'),
  ('healthcare',  'Healthcare',  'Clinics, hospitals, diagnostic centres, healthcare providers'),
  ('education',   'Education',   'Schools, coaching centres, e-learning platforms'),
  ('hospitality', 'Hospitality', 'Hotels, resorts, restaurants, event venues'),
  ('medical',     'Medical',     'Medical practices and healthcare providers (alias for healthcare)'),
  ('real_estate', 'Real Estate', 'Property sales, rentals, property management'),
  ('automotive',  'Automotive',  'Car dealerships, service centres, vehicle rentals'),
  ('logistics',   'Logistics',   'Warehousing, freight, courier, supply chain')
ON CONFLICT (name) DO NOTHING;

INSERT INTO entity.tenant_plan_types (name, label, description) VALUES
  ('free_trial', 'Free Trial', 'Up to 3 iam.users, 1 org, 100 leads — 30-day trial'),
  ('starter',    'Starter',    'Up to 10 iam.users, 2 orgs, 1 000 leads/month'),
  ('growth',     'Growth',     'Up to 50 iam.users, 10 orgs, 10 000 leads/month, AI scoring'),
  ('enterprise', 'Enterprise', 'Unlimited iam.users and orgs, dedicated support, custom SLA')
ON CONFLICT (name) DO NOTHING;

-- hr.leave_request_statuses used to be seeded here as global rows. It is
-- tenant-scoped as of 1.26.0, like its three sibling HR lookups, so its
-- defaults now live in the catalog registry (07_catalog_registry.sql) and are
-- provisioned per tenant by entity.seed_tenant_defaults().

COMMIT;
