-- ===================================================================
-- reference_data/05_comms_templates.sql — Message templates
--
-- Copied per tenant rather than shared: a WhatsApp template names a
-- provider-approved template id belonging to one business, so two
-- tenants must not share a row. entity.seed_tenant_comms_templates()
-- does the copying.
--
-- Reference data: required by every deployment, demo or production.
-- Idempotent (ON CONFLICT), so re-running is safe.
-- ===================================================================

BEGIN;

-- ===================================================================
-- COMMS -- MESSAGE TEMPLATES
-- ===================================================================
-- Seeded GLOBAL (tenant_id + org_id NULL) so every tenant inherits them. A
-- tenant or a single branch can override any of these by inserting a row with
-- the same (module, channel, name) and their own tenant_id/org_id — the
-- resolver takes the most specific match.
--
-- !! The provider_template_name values below are PLACEHOLDERS. WhatsApp sends
-- !! fail with an Interakt "template not found" error until each one matches a
-- !! template actually approved in your Interakt/Meta console. Replace them
-- !! before going live. The email rows need no approval — their copy is right
-- !! here and we interpolate it ourselves.
--
-- body_fields are ORDERED placeholder tokens. The token NAMES are resolved by
-- the owning product service, which holds its own whitelist: leads-service
-- knows lead_first_name/rep_name/org_name. A token no resolver recognises is a
-- config error and fails the send rather than sending a literal '{{1}}'.
INSERT INTO comms.message_templates
  (module, channel, name, label, description,
   provider_template_name, language_code, subject, body_template, preview_text,
   body_fields, sort_order) VALUES

  -- ── LMS / WhatsApp ────────────────────────────────────────────────
  ('lms', 'whatsapp', 'lead_intro', 'Introduction',
   'First contact after a lead comes in.',
   'lead_intro_v1', 'en', NULL, NULL,
   'Hi {{1}}, this is {{2}}. Thanks for your interest — I''ll be helping you from here. When is a good time to talk?',
   ARRAY['lead_first_name','rep_name'], 1),
  ('lms', 'whatsapp', 'lead_follow_up', 'Follow-up reminder',
   'Nudge a lead who has gone quiet.',
   'lead_follow_up_v1', 'en', NULL, NULL,
   'Hi {{1}}, just following up on our earlier conversation. Let me know if you have any questions — {{2}}',
   ARRAY['lead_first_name','rep_name'], 2),
  ('lms', 'whatsapp', 'lead_appointment', 'Appointment confirmation',
   'Confirm a scheduled visit or call.',
   'lead_appointment_v1', 'en', NULL, NULL,
   'Hi {{1}}, your appointment with {{2}} is confirmed. See you soon!',
   ARRAY['lead_first_name','org_name'], 3),
  ('lms', 'whatsapp', 'lead_thank_you', 'Thank you',
   'Send after a visit or a completed conversation.',
   'lead_thank_you_v1', 'en', NULL, NULL,
   'Thank you for your time today, {{1}}. Do reach out any time if anything comes up.',
   ARRAY['lead_first_name'], 4),

  -- ── LMS / Email ───────────────────────────────────────────────────
  -- Copy lives here, not at a provider. Same {{n}} placeholder convention so
  -- one resolver serves both channels.
  ('lms', 'email', 'lead_intro', 'Introduction',
   'First contact after a lead comes in.',
   NULL, 'en',
   'Thanks for your interest, {{1}}',
   E'Hi {{1}},\n\nThanks for reaching out. I''m {{2}} and I''ll be looking after your enquiry from here.\n\nWhen would be a good time for a quick call?\n\nBest regards,\n{{2}}',
   'Thanks for your interest, {{1}} — introduction from the assigned rep.',
   ARRAY['lead_first_name','rep_name'], 1),
  ('lms', 'email', 'lead_follow_up', 'Follow-up reminder',
   'Nudge a lead who has gone quiet.',
   NULL, 'en',
   'Following up, {{1}}',
   E'Hi {{1}},\n\nJust following up on our earlier conversation — happy to answer any questions whenever you are ready.\n\nBest regards,\n{{2}}',
   'Following up, {{1}} — gentle nudge from the assigned rep.',
   ARRAY['lead_first_name','rep_name'], 2)

-- The WHERE clause is required, not decorative: uix_message_templates_audience_name
-- is a PARTIAL index, and ON CONFLICT can only infer a partial index when the
-- predicate is restated here.
ON CONFLICT (tenant_id, org_id, module, channel, name) WHERE NOT is_deleted DO NOTHING;

COMMIT;
