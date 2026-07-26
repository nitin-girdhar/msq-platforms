#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install a daily cron entry for retention-cleanup.sh.
#
# Adds (or replaces) one crontab line that runs the cleanup every day at 02:30,
# in --apply mode, logging to /var/log/attendance-retention.log. Re-running this
# script is safe — it replaces the previous entry rather than stacking duplicates.
#
# Reads (passed through to the cleanup job):
#   DATABASE_URL, BLOB_STORAGE_DIR, DEFAULT_RETENTION_DAYS
#
# Usage:
#   DATABASE_URL=postgres://… BLOB_STORAGE_DIR=/data/blobs ./setup-cron.sh
#   CRON_SCHEDULE="0 3 * * *" ./setup-cron.sh      # custom schedule
#   ./setup-cron.sh --remove                        # uninstall
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLEANUP="$SCRIPT_DIR/retention-cleanup.sh"
MARKER="# msq-attendance-retention"
CRON_SCHEDULE="${CRON_SCHEDULE:-30 2 * * *}"
LOG_FILE="${RETENTION_LOG_FILE:-/var/log/attendance-retention.log}"

if [[ "${1:-}" == "--remove" ]]; then
  crontab -l 2>/dev/null | grep -v "$MARKER" | crontab - || true
  echo "Removed the attendance-retention cron entry."
  exit 0
fi

chmod +x "$CLEANUP"

# Carry the environment the job needs into the cron line (cron runs with a bare
# environment). Only forward the vars that are actually set.
ENV_PREFIX=""
for var in DATABASE_URL BLOB_STORAGE_DIR DEFAULT_RETENTION_DAYS; do
  val="${!var:-}"
  [[ -n "$val" ]] && ENV_PREFIX+="$var='$val' "
done

CRON_LINE="$CRON_SCHEDULE ${ENV_PREFIX}$CLEANUP --apply >> $LOG_FILE 2>&1 $MARKER"

# Replace any existing marked entry, then append the new one.
( crontab -l 2>/dev/null | grep -v "$MARKER"; echo "$CRON_LINE" ) | crontab -

echo "Installed cron entry:"
echo "  $CRON_LINE"
echo "Logs: $LOG_FILE"
