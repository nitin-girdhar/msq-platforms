-- ===================================================================
-- 18_account_lockout_decay.sql
--
-- Follow-up to 17_account_lockout.sql. Adds the timestamp needed to give
-- the failed-attempt counter a TIME WINDOW rather than letting it
-- accumulate forever.
--
-- Problem being fixed: with 17 alone, failed_login_attempts only ever
-- reset on a successful login. Nine failed attempts spread over six
-- months would leave an account one typo away from a lockout, and a user
-- whose 15-minute lock had just expired still carried a full counter, so
-- their very next mistake re-locked them immediately.
--
-- With last_failed_login_at, recordFailedLogin restarts the count at 1
-- when the previous failure is older than LOGIN_ATTEMPT_WINDOW_MINUTES.
-- Setting that window equal to the lockout duration (the default) means
-- an expired lock also yields a fresh budget -- one mechanism covers both
-- the decay and the post-lock reset.
--
-- Guarded/idempotent: ADD COLUMN IF NOT EXISTS, safe to re-run.
-- ===================================================================

ALTER TABLE iam.users
  ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ;

COMMENT ON COLUMN iam.users.last_failed_login_at IS
  'Timestamp of the most recent failed login. Used to expire a stale failed_login_attempts count (see LOGIN_ATTEMPT_WINDOW_MINUTES).';
