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

INSERT INTO marketing.marketing_platforms (name, label, description) VALUES
  ('facebook',     'Facebook',     'Facebook / Instagram Lead Ads and Campaigns'),
  ('google',       'Google',       'Google Ads (Search, Display, Shopping, Performance Max)'),
  ('instagram',    'Instagram',    'Instagram organic and paid posts'),
  ('youtube',      'YouTube',      'YouTube video ads'),
  ('whatsapp',     'WhatsApp',     'WhatsApp click-to-chat ads via Facebook Ads Manager'),
  ('linkedin',     'LinkedIn',     'LinkedIn Lead Gen Forms and sponsored content'),
  ('tiktok',       'TikTok',       'TikTok for Business lead generation'),
  ('organic',      'Organic',      'Walk-in, direct website, or offline enquiry with no paid source'),
  ('referral',     'Referral',     'Referred by an existing customer or partner'),
  ('whatsapp_ads', 'WhatsApp Ads', 'WhatsApp click-to-chat ads via Facebook Ads Manager (legacy alias)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO marketing.campaign_statuses (name, label, description) VALUES
  ('draft',     'Draft',     'Campaign created but not yet submitted for review or activation'),
  ('active',    'Active',    'Campaign is live and currently running'),
  ('paused',    'Paused',    'Campaign temporarily paused; can be resumed'),
  ('completed', 'Completed', 'Campaign ran its full duration and ended normally'),
  ('archived',  'Archived',  'Campaign permanently closed and moved to archive')
ON CONFLICT (name) DO NOTHING;


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

-- ── Lookup seed data (hr.leave_request_statuses only — global, not tenant-scoped) ──
INSERT INTO hr.leave_request_statuses (name, label) VALUES
  ('draft',     'Draft'),
  ('pending',   'Pending'),
  ('approved',  'Approved'),
  ('rejected',  'Rejected'),
  ('cancelled', 'Cancelled'),
  ('withdrawn', 'Withdrawn')
ON CONFLICT (name) DO NOTHING;

COMMIT;
