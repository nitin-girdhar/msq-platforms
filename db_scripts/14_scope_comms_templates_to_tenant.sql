-- ===================================================================
-- Assign the seeded comms.message_templates to their owning tenant.
--
-- 07_seed_lookup_data.sql seeds these rows GLOBAL (tenant_id IS NULL) because
-- it runs before entity.tenants is populated — the same ordering constraint
-- that puts 13/17/19 after the demo seed. This script runs once tenants exist
-- and stamps the catalog with its owner.
--
-- Why FitClass specifically rather than a copy per tenant (the fan-out that
-- _migrations/17_tenant_scope_lms_catalogs.sql does for the lead catalogs):
-- a WhatsApp template is not generic reference data. Each row names a template
-- APPROVED IN A PARTICULAR INTERAKT/META ACCOUNT, and that account belongs to
-- one business. Cloning 'lead_intro_v1' to every tenant would hand each of them
-- a template name that is not approved under their own WhatsApp sender, so every
-- send would fail at the provider. Ownership here is deliberate, not incidental.
--
-- To give another tenant its own set, add its name to TENANT_NAMES below AND
-- seed rows carrying that tenant's own approved provider_template_name values.
--
-- Idempotent: re-running finds no global rows left and does nothing. Safe on a
-- core-only install with no tenants — it simply finds no match and no-ops.
-- ===================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT id INTO v_tenant_id
  FROM entity.tenants
  WHERE name = 'FitClass' AND NOT is_deleted
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'comms templates: tenant "FitClass" not present, leaving rows global.';
    RETURN;
  END IF;

  -- A re-run of 07 after this script has already run re-inserts the global rows
  -- (ON CONFLICT cannot match them against the now tenant-owned copies). Retire
  -- those strays first, or the UPDATE below would collide with the existing
  -- tenant rows on uix_message_templates_audience_name.
  --
  -- DELETE here is a SOFT delete: public.soft_delete_row() rewrites it to
  -- is_deleted = TRUE for every login except root_service. That is exactly what
  -- we want — the unique index is partial (WHERE NOT is_deleted), so retired
  -- rows stop competing for the key while the audit trail survives.
  DELETE FROM comms.message_templates g
  WHERE g.tenant_id IS NULL
    AND NOT g.is_deleted
    AND EXISTS (
      SELECT 1 FROM comms.message_templates t
      WHERE t.tenant_id = v_tenant_id
        AND t.org_id IS NULL
        AND NOT t.is_deleted
        AND t.module  = g.module
        AND t.channel = g.channel
        AND t.name    = g.name
    );

  UPDATE comms.message_templates
  SET tenant_id = v_tenant_id
  WHERE tenant_id IS NULL
    AND NOT is_deleted;

  RAISE NOTICE 'comms templates: assigned % row(s) to tenant FitClass (%).',
    (SELECT count(*) FROM comms.message_templates
     WHERE tenant_id = v_tenant_id AND NOT is_deleted),
    v_tenant_id;
END $$;

COMMIT;
