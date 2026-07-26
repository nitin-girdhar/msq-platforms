-- ===================================================================
-- 20_user_photos_and_attendance_retention.sql
--
-- Adds the profile-photo / face-attendance columns to an EXISTING deployment.
-- A fresh install never needs this: 02_schema.sql and 03_product_schema.sql
-- already create these columns directly (this script and those definitions are
-- kept in lock-step).
--
-- Two independent shapes are added:
--   1. iam.users               — avatar pointer + DPDP consent metadata. Bytes
--                                live in blob storage; only the opaque key is
--                                kept in the DB (no bytea, no SELECT bloat).
--   2. hr.attendance_rules     — per-org photo-change cooldown + selfie
--                                retention window.
--
-- Plus a one-time backfill: any employee already enrolled for face attendance
-- (hr.employee_profiles.reference_photo_url) gets that same key mirrored onto
-- iam.users.photo_key so their existing reference doubles as their avatar. The
-- HR enrollment columns (reference_photo_url / face_subject_id) are left intact
-- — they remain the CompreFace pointer.
--
-- Fully idempotent: ADD COLUMN IF NOT EXISTS + a guarded UPDATE. Safe to re-run.
-- Run inside one transaction so a partial apply can't leave half the columns.
-- ===================================================================

BEGIN;

-- ── 1. iam.users — avatar pointer + consent metadata ───────────────
ALTER TABLE iam.users
  ADD COLUMN IF NOT EXISTS photo_key          TEXT,
  ADD COLUMN IF NOT EXISTS photo_content_type TEXT,
  ADD COLUMN IF NOT EXISTS photo_uploaded_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS photo_uploaded_by  UUID,
  ADD COLUMN IF NOT EXISTS photo_consent_at   TIMESTAMPTZ;

-- ── 2. hr.attendance_rules — cooldown + retention ──────────────────
ALTER TABLE hr.attendance_rules
  ADD COLUMN IF NOT EXISTS photo_change_cooldown_days INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS image_retention_days       INT NOT NULL DEFAULT 90;

-- CHECK constraints, added separately so re-running past an existing column is
-- still safe (ADD CONSTRAINT has no IF NOT EXISTS; guard via catalog lookup).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_rules_cooldown_nonneg'
  ) THEN
    ALTER TABLE hr.attendance_rules
      ADD CONSTRAINT chk_attendance_rules_cooldown_nonneg CHECK (photo_change_cooldown_days >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_attendance_rules_retention_pos'
  ) THEN
    ALTER TABLE hr.attendance_rules
      ADD CONSTRAINT chk_attendance_rules_retention_pos CHECK (image_retention_days >= 1);
  END IF;
END $$;

-- ── 3. Backfill: mirror existing enrolled reference photos onto the avatar ──
-- Only touch rows that have a reference but no avatar yet (idempotent). The
-- upload timestamp is unknown for historical rows, so consent/upload metadata
-- is left NULL — status endpoints already read consent from employee_profiles.
UPDATE iam.users u
SET    photo_key = ep.reference_photo_url,
       photo_content_type = 'image/jpeg'
FROM   hr.employee_profiles ep
WHERE  ep.user_id = u.id
  AND  ep.reference_photo_url IS NOT NULL
  AND  NOT ep.is_deleted
  AND  u.photo_key IS NULL;

COMMIT;
