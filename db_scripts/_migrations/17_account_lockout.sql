-- ===================================================================
-- 17_account_lockout.sql
--
-- Adds per-account failed-login tracking to iam.users so credential
-- stuffing is throttled at the ACCOUNT level, independent of source IP.
--
-- Why account-level and not just the gateway's IP limiter: the gateway
-- limiter (services/api-gateway/src/lib/rate-limit.ts) keys on client IP,
-- so an attacker rotating IPs gets unlimited attempts against a known
-- email. These two columns move the counter onto the thing being
-- attacked -- the account -- which no amount of IP rotation evades.
--
-- Guarded/idempotent: ADD COLUMN IF NOT EXISTS, safe to re-run. A DB
-- installed fresh from the updated 02_schema.sql already has both columns
-- and this migration is a no-op there.
--
-- Semantics (enforced in identity-service auth.service.ts):
--   failed_login_attempts  running count of consecutive failures; reset to
--                          0 on any successful login or password change.
--   locked_until           NULL = not locked. When set and in the future,
--                          login is refused before the bcrypt compare.
-- ===================================================================

ALTER TABLE iam.users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until          TIMESTAMPTZ;

COMMENT ON COLUMN iam.users.failed_login_attempts IS
  'Consecutive failed login attempts; reset to 0 on successful login or password change.';
COMMENT ON COLUMN iam.users.locked_until IS
  'When set and in the future, login is refused. Cleared on successful login or password change.';

-- Supports the "which accounts are currently locked" admin/monitoring query
-- without scanning the whole user table. Partial: locked rows are a tiny
-- minority, so the index stays small.
CREATE INDEX IF NOT EXISTS idx_users_locked_until
  ON iam.users (locked_until)
  WHERE locked_until IS NOT NULL;
