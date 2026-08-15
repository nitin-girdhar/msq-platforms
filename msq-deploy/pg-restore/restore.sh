#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Restore the latest Postgres backup from Google Drive into the running
# postgres container on THIS box.
#
# Downloads the newest *.sql.gz.gpg from RCLONE_REMOTE, decrypts, decompresses,
# then pipes the plain SQL into `docker exec -i psql` — same docker-exec +
# PGPASSWORD pattern bootstrap-db.sh and deploy_linux.md already use to talk to
# the postgres container. Because the source dump was taken with
# `pg_dumpall --clean --if-exists`, the SQL itself contains DROP/CREATE
# statements for every role and database, so this run is idempotent and fully
# replaces roles + all databases with whatever the source box last backed up.
#
# Same script for the 2 AM cron job and for an ad-hoc manual run — there is no
# separate "trigger mode".
#
# Reads:
#   COMPOSE_DIR       dir holding docker-compose.yml + .env (default: one
#                      directory up from this script — this pg-restore/ folder
#                      is expected to sit alongside docker-compose.yml/.env)
#   WORK_DIR          scratch dir for downloaded/decrypted files
#                      (default: /deployment/data/database_backup)
#   RCLONE_REMOTE     rclone remote:path to pull from (required, e.g. gdrive:pg-backups)
#   PASSPHRASE_FILE   GPG passphrase file, chmod 600 (default: $SCRIPT_DIR/.secrets/passphrase)
#                      — MUST be the same passphrase the source box encrypted with.
#   LOG_FILE          (default: /var/log/pg-restore.log)
#
# Requires on PATH: docker, gunzip, gpg, rclone.
#
# Usage:
#   ./restore.sh                 # normal run (cron or ad-hoc — identical)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
WORK_DIR="${WORK_DIR:-/deployment/data/database_backup}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-$SCRIPT_DIR/.secrets/passphrase}"
LOG_FILE="${LOG_FILE:-/var/log/pg-restore.log}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG_FILE"; }
die() { log "ERROR: $*"; exit 1; }

mkdir -p "$WORK_DIR" "$(dirname "$LOG_FILE")"

command -v docker >/dev/null 2>&1 || die "docker not found on PATH (cron has a bare PATH; set PATH explicitly in the crontab entry)."
command -v gpg    >/dev/null 2>&1 || die "gpg not found on PATH. Install gnupg."
command -v rclone >/dev/null 2>&1 || die "rclone not found on PATH. Install rclone and run 'rclone config' first."
[[ -n "$RCLONE_REMOTE" ]] || die "RCLONE_REMOTE not set (e.g. gdrive:pg-backups)."
[[ -f "$COMPOSE_DIR/.env" ]] || die "no .env in $COMPOSE_DIR. Set COMPOSE_DIR."
[[ -f "$PASSPHRASE_FILE" ]] || die "no GPG passphrase file at $PASSPHRASE_FILE. Copy the SAME passphrase used on the source box (chmod 600)."

set -a
# shellcheck disable=SC1090
. "$COMPOSE_DIR/.env"
set +a

: "${DB_CONTAINER_NAME:?not set in $COMPOSE_DIR/.env}"
: "${POSTGRES_USER:?not set in $COMPOSE_DIR/.env}"
: "${POSTGRES_PASSWORD:?not set in $COMPOSE_DIR/.env}"

log "==> Starting restore (container=$DB_CONTAINER_NAME)"

docker inspect -f '{{.State.Running}}' "$DB_CONTAINER_NAME" 2>/dev/null | grep -q true \
  || die "$DB_CONTAINER_NAME is not running — start the stack before restoring."

log "==> Finding newest backup on $RCLONE_REMOTE"
LATEST="$(rclone lsf "$RCLONE_REMOTE" --files-only | sort | tail -n 1)"
[[ -n "$LATEST" ]] || die "no backup files found on $RCLONE_REMOTE."
log "    -> $LATEST"

ENC_FILE="$WORK_DIR/$LATEST"
GZ_FILE="${ENC_FILE%.gpg}"
SQL_FILE="${GZ_FILE%.gz}"
cleanup() { rm -f "$ENC_FILE" "$GZ_FILE" "$SQL_FILE"; }
trap cleanup EXIT

log "==> Downloading"
rclone copy "$RCLONE_REMOTE/$LATEST" "$WORK_DIR" || die "rclone download failed."

log "==> Decrypting"
gpg --batch --yes --passphrase-file "$PASSPHRASE_FILE" --decrypt "$ENC_FILE" > "$GZ_FILE" \
  || die "gpg decryption failed — check PASSPHRASE_FILE matches the source box."

log "==> Decompressing"
gunzip -f "$GZ_FILE"

[[ -s "$SQL_FILE" ]] || die "decrypted dump is empty — aborting, not restoring."

log "==> Restoring into $DB_CONTAINER_NAME (this replaces every role and database from the dump)"
# Connect via template1, not the default "postgres" maintenance DB: the dump's
# --clean output includes "DROP DATABASE postgres", which fails if psql's own
# connection is what's holding it open.
docker exec -i -e "PGPASSWORD=$POSTGRES_PASSWORD" "$DB_CONTAINER_NAME" \
  psql -U "$POSTGRES_USER" -d template1 -v ON_ERROR_STOP=1 -q < "$SQL_FILE" \
  || die "psql restore failed — check $LOG_FILE for the exact statement."

log "==> Restore complete: $LATEST"
