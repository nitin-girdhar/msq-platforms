-- ===================================================================
-- 19_password_spray_detection.sql
--
-- Detection for password SPRAYING, which the per-account lockout from
-- migrations 17/18 deliberately does not catch.
--
-- The two attacks have opposite shapes:
--   brute force -> MANY failures against ONE account
--                  (caught by failed_login_attempts / locked_until)
--   spraying    -> ONE or TWO tries against MANY accounts
--                  (every account's counter stays at 1-2, so no lockout
--                   ever fires and nothing looks wrong per-account)
--
-- Spraying is only visible in aggregate, so this works off the
-- audit.activities rows identity-service already writes on every failed
-- login (`action_type = 'login_failure'`). No new write path, no hot-path
-- cost -- it is a read-side query over data that already exists.
--
-- NOTE ON TARGET IDENTIFICATION: `performed_by` is NULL when the email did
-- not resolve to a user (reason = 'user_not_found'), which is exactly what a
-- spray against guessed addresses looks like. So the DISTINCT count keys on
-- `meta->>'email'` instead -- that is populated for every failure reason.
--
-- Idempotent: CREATE OR REPLACE + IF NOT EXISTS.
-- ===================================================================

-- Supports the windowed scans below without a seq scan over all activity.
-- Partial: login failures are a small slice of the table.
CREATE INDEX IF NOT EXISTS idx_activities_login_failure
  ON audit.activities (created_at DESC, org_id)
  WHERE action_type IN ('login_failure', 'account_locked');

-- ── Spray detector ──────────────────────────────────────────────────
-- Returns one row per org whose DISTINCT-targeted-account count in the
-- window crosses the threshold. Tune per environment: a 500-person org has
-- a higher benign floor than a 10-person one.
CREATE OR REPLACE FUNCTION audit.fn_detect_password_spray(
  p_window_minutes        INT DEFAULT 15,
  p_min_distinct_accounts INT DEFAULT 10
)
RETURNS TABLE (
  org_id                 UUID,
  distinct_accounts      BIGINT,
  total_failures         BIGINT,
  failures_per_account   NUMERIC,
  first_seen             TIMESTAMPTZ,
  last_seen              TIMESTAMPTZ,
  sample_emails          TEXT[]
)
LANGUAGE sql STABLE AS $$
  SELECT
    a.org_id,
    COUNT(DISTINCT a.meta->>'email')                              AS distinct_accounts,
    COUNT(*)                                                      AS total_failures,
    ROUND(COUNT(*)::numeric
          / NULLIF(COUNT(DISTINCT a.meta->>'email'), 0), 2)       AS failures_per_account,
    MIN(a.created_at)                                             AS first_seen,
    MAX(a.created_at)                                             AS last_seen,
    (ARRAY_AGG(DISTINCT a.meta->>'email'))[1:5]                   AS sample_emails
  FROM audit.activities a
  WHERE a.action_type = 'login_failure'
    AND a.created_at >= CLOCK_TIMESTAMP() - make_interval(mins => p_window_minutes)
    AND a.meta->>'email' IS NOT NULL
  GROUP BY a.org_id
  HAVING COUNT(DISTINCT a.meta->>'email') >= p_min_distinct_accounts
  ORDER BY COUNT(DISTINCT a.meta->>'email') DESC;
$$;

COMMENT ON FUNCTION audit.fn_detect_password_spray(INT, INT) IS
  'Password-spray detector: orgs where many DISTINCT accounts failed login in a short window. A low failures_per_account (~1-2) alongside a high distinct_accounts is the spray signature; a high ratio is ordinary brute force, already handled by account lockout.';

-- ── Convenience view over the default thresholds (15 min / 10 accounts) ──
-- For a dashboard panel or a cron'd alert query.
CREATE OR REPLACE VIEW audit.vw_password_spray_alerts AS
  SELECT * FROM audit.fn_detect_password_spray(15, 10);

COMMENT ON VIEW audit.vw_password_spray_alerts IS
  'Password-spray alerts over the last 15 minutes (>=10 distinct accounts). Poll this from your alerting system.';

GRANT EXECUTE ON FUNCTION audit.fn_detect_password_spray(INT, INT) TO root_service;
GRANT SELECT ON audit.vw_password_spray_alerts TO root_service;
