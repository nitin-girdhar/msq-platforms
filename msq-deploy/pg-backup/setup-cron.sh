#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Install a daily cron entry for backup.sh.
#
# Adds (or replaces) one crontab line that runs the Postgres backup every day
# at 01:00, logging to /var/log/pg-backup.log. Re-running this script is safe —
# it replaces the previous entry rather than stacking duplicates.
#
# NO SECRETS IN THE CRONTAB. backup.sh reads DB credentials from
# COMPOSE_DIR/.env and only the GPG passphrase FILE path (never its contents)
# and RCLONE_REMOTE are forwarded here.
#
# Reads (paths only, all optional except RCLONE_REMOTE):
#   CRON_SCHEDULE     cron expression (default: 0 1 * * *)
#   PG_BACKUP_LOG     log path (default: /var/log/pg-backup.log)
#   COMPOSE_DIR       dir with docker-compose.yml + .env
#   BACKUP_DIR        default: /deployment/data/database_backup
#   RCLONE_REMOTE     rclone remote:path (required — e.g. gdrive:pg-backups)
#   PASSPHRASE_FILE   GPG passphrase file path
#   RETENTION_DAYS    default: 7
#   DOCKER_BIN_DIR    dir containing docker/rclone/gpg, prepended to cron's PATH
#
# Usage:
#   RCLONE_REMOTE=gdrive:pg-backups ./setup-cron.sh
#   CRON_SCHEDULE="0 2 * * *" RCLONE_REMOTE=gdrive:pg-backups ./setup-cron.sh
#   ./setup-cron.sh --remove
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOB="$SCRIPT_DIR/backup.sh"
MARKER="# msq-pg-backup"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 1 * * *}"
LOG_FILE="${PG_BACKUP_LOG:-/var/log/pg-backup.log}"

if [[ "${1:-}" == "--remove" ]]; then
  crontab -l 2>/dev/null | grep -v "$MARKER" | crontab - || true
  echo "Removed the pg-backup cron entry."
  exit 0
fi

[[ -f "$JOB" ]] || { echo "ERROR: $JOB not found." >&2; exit 2; }
chmod +x "$JOB"
[[ -n "${RCLONE_REMOTE:-}" ]] || { echo "ERROR: RCLONE_REMOTE must be set (e.g. gdrive:pg-backups)." >&2; exit 2; }

ENV_PREFIX=""
for var in COMPOSE_DIR BACKUP_DIR RCLONE_REMOTE PASSPHRASE_FILE RETENTION_DAYS LOG_FILE; do
  val="${!var:-}"
  [[ -n "$val" ]] && ENV_PREFIX+="$var='$val' "
done

# cron runs with a minimal PATH that usually excludes docker/rclone/gpg. Pin it
# if given, otherwise pass through the directory docker currently resolves from.
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
echo "Verify it end-to-end BEFORE trusting the schedule:"
echo "  $JOB"
