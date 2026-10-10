-- ===================================================================
-- reference_data/04_lms_catalog_templates.sql — LMS catalog templates
--
-- Lead stages, outcomes, interaction types, follow-up statuses and
-- sources, plus the Meta CAPI event mapping.
-- 
-- All seeded as TEMPLATES (tenant_id IS NULL) and copied per tenant by
-- entity.seed_tenant_lms_catalogs(). ext.meta_capi_event_types is the
-- exception: it is a genuinely global vocabulary.
--
-- Reference data: required by every deployment, demo or production.
-- Idempotent (ON CONFLICT), so re-running is safe.
-- ===================================================================

BEGIN;

-- ===================================================================
-- CRM -- LEAD STAGES, OUTCOMES, INTERACTION TYPES, FOLLOW-UP STATUSES, SOURCES
-- ===================================================================

INSERT INTO lms.lead_stage (name, label, description, sort_order, followup_required, is_rejected, is_terminated) VALUES
  ('new',            'New',            'Lead just received — not yet contacted',                       1, FALSE, FALSE, FALSE),
  ('contacting',     'Contacting',     'Active outreach in progress — calls, WhatsApp, or email',      2, TRUE,  FALSE, FALSE),
  ('on_hold',        'On Hold',        'Follow-up temporarily paused — lead asked to be contacted later or is unreachable', 3, TRUE,  FALSE, FALSE),
  ('qualified',      'Qualified',      'Lead confirmed as a genuine prospect with intent and budget',  4, TRUE,  FALSE, FALSE),
  ('converted',      'Converted',      'Lead became a paying customer',                                5, FALSE, FALSE, TRUE),
  ('unqualified',    'Unqualified',    'Lead did not qualify — outcome and note must be recorded',     6, FALSE, TRUE,  TRUE),
  ('transferred_out','Transferred Out','Lead transferred to another org or partner',                   7, FALSE, FALSE, TRUE)
ON CONFLICT (name) WHERE tenant_id IS NULL DO UPDATE SET
  label             = EXCLUDED.label,
  description       = EXCLUDED.description,
  sort_order        = EXCLUDED.sort_order,
  followup_required = EXCLUDED.followup_required,
  is_rejected       = EXCLUDED.is_rejected,
  is_terminated     = EXCLUDED.is_terminated;

-- Seed all outcomes using name subqueries (never hardcoded IDs)
DO $$
DECLARE
  v_contacting  UUID;
  v_on_hold     UUID;
  v_qualified   UUID;
  v_converted   UUID;
  v_unqualified UUID;
  v_transferred UUID;
BEGIN
  SELECT id INTO v_contacting  FROM lms.lead_stage WHERE name = 'contacting' AND tenant_id IS NULL;
  SELECT id INTO v_on_hold     FROM lms.lead_stage WHERE name = 'on_hold' AND tenant_id IS NULL;
  SELECT id INTO v_qualified   FROM lms.lead_stage WHERE name = 'qualified' AND tenant_id IS NULL;
  SELECT id INTO v_converted   FROM lms.lead_stage WHERE name = 'converted' AND tenant_id IS NULL;
  SELECT id INTO v_unqualified FROM lms.lead_stage WHERE name = 'unqualified' AND tenant_id IS NULL;
  SELECT id INTO v_transferred FROM lms.lead_stage WHERE name = 'transferred_out' AND tenant_id IS NULL;

  -- contacting outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_contacting, 'not_connected',   'Not Connected',   FALSE, 1),
    (v_contacting, 'switch_off',      'Switch Off',      FALSE, 2),
    (v_contacting, 'not_answered',    'Not Answered',    FALSE, 3),
    (v_contacting, 'call_back_later', 'Call Back Later', FALSE, 4),
    (v_contacting, 'other',           'Other',           TRUE,  5)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- on_hold outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, sort_order) VALUES
    (v_on_hold, 'on_hold', 'On Hold', 1)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- qualified outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_qualified, 'visit_scheduled', 'Visit Scheduled', FALSE, 1),
    (v_qualified, 'visited',         'Visited',         FALSE, 2),
    (v_qualified, 'other',           'Other',           TRUE,  3)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- converted outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_converted, 'membership_sold', 'Membership Sold', FALSE, 1),
    (v_converted, 'other',           'Other',           TRUE,  2)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- unqualified outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_unqualified, 'no_response_after_multiple_attempts', 'No Response After Multiple Attempts', FALSE, 1),
    (v_unqualified, 'wrong_number',                        'Wrong Number',                        FALSE, 2),
    (v_unqualified, 'job_applicant',                       'Job Applicant',                       FALSE, 3),
    (v_unqualified, 'budget_issue',                        'Budget Issue',                        FALSE, 4),
    (v_unqualified, 'not_interested',                      'Not Interested',                      FALSE, 5),
    (v_unqualified, 'location_issue',                      'Location Issue',                      FALSE, 6),
    (v_unqualified, 'duplicate_lead',                      'Duplicate Lead',                      FALSE, 7),
    (v_unqualified, 'other',                               'Other',                               TRUE,  8)
  ON CONFLICT (stage_id, name) DO NOTHING;

  -- transferred_out outcomes
  INSERT INTO lms.lead_stage_outcome (stage_id, name, label, requires_comment, sort_order) VALUES
    (v_transferred, 'transferred_to_other_branch', 'Transferred to Other Branch', FALSE, 1),
    (v_transferred, 'other',                       'Other',                       TRUE,  2)
  ON CONFLICT (stage_id, name) DO NOTHING;
END;
$$;

-- ===================================================================
-- EXT -- META CAPI EVENT TYPES + LEAD STAGE -> CAPI EVENT MAPPING
-- ===================================================================

-- 1.79.0: one distinct event per funnel stage instead of a catch-all 'Other'. Meta's Conversion
-- Leads optimisation learns from the SEQUENCE of stages a lead reaches, so each stage needs its own
-- name, and funnel_rank is what lets the outbox send the stages a lead jumped over, in order.
-- UnqualifiedLead is a negative signal (outside the sequence). 'Other' is retired (inactive): rows
-- that still point at it keep working, but it is no longer offered.
INSERT INTO ext.meta_capi_event_types (code, label, sort_order, funnel_rank, is_negative, is_active) VALUES
  ('Lead',            'Lead',             1, 10,   FALSE, TRUE),
  ('ContactedLead',   'Contacted Lead',   2, 20,   FALSE, TRUE),
  ('QualifiedLead',   'Qualified Lead',   3, 30,   FALSE, TRUE),
  ('ConvertedLead',   'Converted Lead',   4, 40,   FALSE, TRUE),
  ('UnqualifiedLead', 'Unqualified Lead', 5, NULL, TRUE,  TRUE),
  ('Other',           'Other (retired)',  9, NULL, FALSE, FALSE)
ON CONFLICT (code) DO UPDATE SET
  label       = EXCLUDED.label,
  sort_order  = EXCLUDED.sort_order,
  funnel_rank = EXCLUDED.funnel_rank,
  is_negative = EXCLUDED.is_negative,
  is_active   = EXCLUDED.is_active;

-- Wire each lead_stage to its Meta CAPI event by id (never by name-string
-- comparison at request time — this join is one-time seed wiring only).
-- Stages not listed here ('on_hold', 'transferred_out') get no row, so no CAPI
-- event fires when a lead transitions into them.
-- Template rows only (tenant_id IS NULL, against the template stages) —
-- entity.seed_tenant_lms_catalogs() clones them into each tenant.
INSERT INTO ext.lead_stage_capi_event_map (tenant_id, stage_id, capi_event_type_id)
SELECT NULL, ls.id, et.id
FROM (VALUES
  ('new',             'Lead'),
  ('contacting',      'ContactedLead'),
  ('qualified',       'QualifiedLead'),
  ('converted',       'ConvertedLead'),
  ('unqualified',     'UnqualifiedLead')
) AS m(stage_name, event_code)
JOIN lms.lead_stage ls            ON ls.name = m.stage_name AND ls.tenant_id IS NULL
JOIN ext.meta_capi_event_types et ON et.code = m.event_code
ON CONFLICT (stage_id) DO UPDATE SET
  capi_event_type_id = EXCLUDED.capi_event_type_id;

-- Retired wiring: these two template stages used to map to 'Other'.
DELETE FROM ext.lead_stage_capi_event_map m
USING lms.lead_stage ls
WHERE ls.id = m.stage_id AND ls.tenant_id IS NULL AND m.tenant_id IS NULL
  AND ls.name IN ('on_hold', 'transferred_out');

INSERT INTO lms.interaction_types (name, label, description) VALUES
  ('call',          'Call',          'Outbound or inbound phone call'),
  ('whatsapp',      'WhatsApp',      'WhatsApp message (text, audio, or media)'),
  ('email',         'Email',         'Email sent or received'),
  ('sms',           'SMS',           'SMS or text message'),
  ('in_person',     'In Person',     'Face-to-face meeting at store, office, or event'),
  ('video_call',    'Video Call',    'Video call via Zoom, Google Meet, WhatsApp Video, etc.'),
  ('chat',          'Chat',          'Live chat on website or social media platform'),
  ('internal_note', 'Internal Note', 'Internal note or annotation added by a team member')
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

INSERT INTO lms.follow_up_statuses (name, label, description) VALUES
  ('pending',     'Pending',     'Follow-up scheduled and not yet actioned'),
  ('completed',   'Completed',   'Follow-up actioned within the scheduled window'),
  ('missed',      'Missed',      'Follow-up was not actioned before the scheduled time'),
  ('rescheduled', 'Rescheduled', 'Follow-up postponed to a new scheduled_at datetime')
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

INSERT INTO lms.lead_sources (name, label) VALUES
  ('facebook',     'Facebook'),
  ('google',       'Google'),
  ('instagram',    'Instagram'),
  ('whatsapp',     'WhatsApp'),
  ('website_form', 'Website Form'),
  ('referral',     'Referral'),
  ('walk_in',      'Walk In'),
  ('cold_call',    'Cold Call'),
  ('other',        'Other')
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

COMMIT;
