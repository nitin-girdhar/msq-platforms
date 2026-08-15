#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Full Postgres backup → Google Drive.
#
# Runs `pg_dumpall` inside the running postgres container — every database,
# every role (including password hashes), all globals/tablespaces — in one
# shot, since `docker exec` + PGPASSWORD is the same pattern bootstrap-db.sh
# and deploy_linux.md already use to talk to the postgres container. The dump
# is gzipped, GPG-symmetric-encrypted (the dump contains role password hashes,
# so plaintext must never reach Drive), then pushed with `rclone`. Files older
# than RETENTION_DAYS are pruned both locally and on the remote at the end of
# each run.
#
# Same script for the 1 AM cron job and for an ad-hoc manual run — there is no
# separate "trigger mode".
#
# Reads:
#   COMPOSE_DIR       dir holding docker-compose.yml + .env (default: one
#                      directory up from this script — this pg-backup/ folder
#                      is expected to sit alongside docker-compose.yml/.env,
#                      same layout as reports/ and retention/)
#   BACKUP_DIR         where dumps land on this host (default: /deployment/data/database_backup)
#   RCLONE_REMOTE      rclone remote:path to upload to (required, e.g. gdrive:pg-backups)
#   PASSPHRASE_FILE    GPG passphrase file, chmod 600 (default: $SCRIPT_DIR/.secrets/passphrase)
#   RETENTION_DAYS     days to keep, local and remote (default: 7)
#   LOG_FILE           (default: /var/log/pg-backup.log)
#
# Requires on PATH: docker, gzip, gpg, rclone.
#
# Usage:
#   ./backup.sh                  # normal run (cron or ad-hoc — identical)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/deployment/data/database_backup}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-$SCRIPT_DIR/.secrets/passphrase}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
LOG_FILE="${LOG_FILE:-/var/log/pg-backup.log}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG_FILE"; }
die() { log "ERROR: $*"; exit 1; }

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")"

command -v docker >/dev/null 2>&1 || die "docker not found on PATH (cron has a bare PATH; set PATH explicitly in the crontab entry)."
command -v gpg    >/dev/null 2>&1 || die "gpg not found on PATH. Install gnupg."
command -v rclone >/dev/null 2>&1 || die "rclone not found on PATH. Install rclone and run 'rclone config' first."
[[ -n "$RCLONE_REMOTE" ]] || die "RCLONE_REMOTE not set (e.g. gdrive:pg-backups)."
[[ -f "$COMPOSE_DIR/.env" ]] || die "no .env in $COMPOSE_DIR. Set COMPOSE_DIR."
[[ -f "$PASSPHRASE_FILE" ]] || die "no GPG passphrase file at $PASSPHRASE_FILE. Create one (chmod 600) before running."

set -a
# shellcheck disable=SC1090
. "$COMPOSE_DIR/.env"
set +a

: "${DB_CONTAINER_NAME:?not set in $COMPOSE_DIR/.env}"
: "${POSTGRES_USER:?not set in $COMPOSE_DIR/.env}"
: "${POSTGRES_PASSWORD:?not set in $COMPOSE_DIR/.env}"

log "==> Starting backup (container=$DB_CONTAINER_NAME)"

docker inspect -f '{{.State.Running}}' "$DB_CONTAINER_NAME" 2>/dev/null | grep -q true \
  || die "$DB_CONTAINER_NAME is not running — refusing to take an empty/failed dump."

STAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/pgbackup_${STAMP}.sql"
ENC_FILE="$DUMP_FILE.gz.gpg"

log "==> Dumping all databases + roles (pg_dumpall)"
docker exec -e "PGPASSWORD=$POSTGRES_PASSWORD" "$DB_CONTAINER_NAME" \
  pg_dumpall -U "$POSTGRES_USER" --clean --if-exists > "$DUMP_FILE" \
  || { rm -f "$DUMP_FILE"; die "pg_dumpall failed."; }

[[ -s "$DUMP_FILE" ]] || die "pg_dumpall produced an empty file — aborting, not uploading."

log "==> Compressing"
gzip -f "$DUMP_FILE"

log "==> Encrypting"
gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" --symmetric --cipher-algo AES256 \
  -o "$ENC_FILE" "$DUMP_FILE.gz" \
  || die "gpg encryption failed."
rm -f "$DUMP_FILE.gz"

log "==> Uploading to $RCLONE_REMOTE"
rclone copy "$ENC_FILE" "$RCLONE_REMOTE" || die "rclone upload failed — $ENC_FILE stays on disk."

log "==> Pruning backups older than ${RETENTION_DAYS}d (local + remote)"
find "$BACKUP_DIR" -name 'pgbackup_*.sql.gz.gpg' -mtime "+$RETENTION_DAYS" -delete
rclone delete --min-age "${RETENTION_DAYS}d" "$RCLONE_REMOTE" || log "WARNING: remote prune failed (non-fatal)."

log "==> Backup complete: $(basename "$ENC_FILE")"
