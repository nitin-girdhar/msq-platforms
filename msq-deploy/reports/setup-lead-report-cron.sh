#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install a daily cron entry for send-lead-report.sh.
#
# Adds (or replaces) one crontab line that emails each LMS tenant's daily lead
# report at 07:30 server time, logging to /var/log/lead-report.log. Re-running
# this script is safe — it replaces the previous entry rather than stacking
# duplicates.
#
# NO SECRETS IN THE CRONTAB. The job runs inside the leads-service container and
# takes its DB credentials, INTERNAL_SERVICE_SECRET and COMMUNICATION_SERVICE_URL
# from artifacts/.env via compose — so this installs only paths, never a
# credential. (Contrast msq-deploy/retention/setup-cron.sh, which must forward
# DATABASE_URL because it runs psql on the host.) A crontab is world-readable to
# the owning user's processes and lands in backups, so keep it that way.
#
# NOTE on the schedule: one fixed server-time run means "New Today" is a partial
# day for any branch whose timezone is behind the server's. The counts are always
# computed in each branch's own timezone (see lms.vw_lead_report_branch); only
# the send moment is global. Per-timezone dispatch would mean running hourly and
# filtering tenants by local time — deliberately not done.
#
# Reads (paths only, all optional):
#   CRON_SCHEDULE        cron expression (default: 30 7 * * *)
#   LEAD_REPORT_LOG_FILE log path (default: /var/log/lead-report.log)
#   COMPOSE_DIR          dir with docker-compose.yml + .env
#                        (default: <repo>/msq-deploy/artifacts)
#   RUN_MODE             run | exec (default: run)
#   DOCKER_BIN_DIR       dir containing docker, prepended to cron's PATH
#
# Usage:
#   ./setup-lead-report-cron.sh
#   CRON_SCHEDULE="0 8 * * *" ./setup-lead-report-cron.sh
#   ./setup-lead-report-cron.sh --remove
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB="$SCRIPT_DIR/send-lead-report.sh"
MARKER="# msq-lead-report"
CRON_SCHEDULE="${CRON_SCHEDULE:-30 7 * * *}"
LOG_FILE="${LEAD_REPORT_LOG_FILE:-/var/log/lead-report.log}"

if [[ "${1:-}" == "--remove" ]]; then
  crontab -l 2>/dev/null | grep -v "$MARKER" | crontab - || true
  echo "Removed the lead-report cron entry."
  exit 0
fi

[[ -f "$JOB" ]] || { echo "ERROR: $JOB not found." >&2; exit 2; }
chmod +x "$JOB"

# Forward only non-secret configuration, and only what is actually set.
ENV_PREFIX=""
for var in COMPOSE_DIR COMPOSE_FILE LEADS_SERVICE RUN_MODE MSQ_REPO_DIR; do
  val="${!var:-}"
  [[ -n "$val" ]] && ENV_PREFIX+="$var='$val' "
done

# cron runs with a minimal PATH that usually excludes docker. Pin it if given,
# otherwise pass through the directory docker currently resolves from.
DOCKER_DIR="${DOCKER_BIN_DIR:-}"
if [[ -z "$DOCKER_DIR" ]] && command -v docker >/dev/null 2>&1; then
  DOCKER_DIR="$(dirname "$(command -v docker)")"
fi
[[ -n "$DOCKER_DIR" ]] && ENV_PREFIX+="PATH='$DOCKER_DIR:/usr/local/bin:/usr/bin:/bin' "

CRON_LINE="$CRON_SCHEDULE ${ENV_PREFIX}$JOB >> $LOG_FILE 2>&1 $MARKER"

( crontab -l 2>/dev/null | grep -v "$MARKER"; echo "$CRON_LINE" ) | crontab -

echo "Installed cron entry:"
echo "  $CRON_LINE"
echo "Logs: $LOG_FILE"
echo
echo "Verify it end-to-end BEFORE trusting the schedule — a dry run sends nothing:"
echo "  $JOB --dry-run"
