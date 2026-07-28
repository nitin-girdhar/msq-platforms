#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Attendance selfie retention cleanup.
#
# Deletes daily check-in/out selfies (blob keys `punch/<userId>/<YYYYMMDD>_*.jpg`)
# once they are older than the owning org's `hr.attendance_rules.image_retention_days`.
# The enrolled reference photo (`avatar/**`) is NEVER touched.
#
# The cutoff is derived from the DATE ENCODED IN THE FILENAME, not the file mtime,
# so a backup/restore or an rsync that rewrites mtimes cannot resurrect or
# prematurely delete an image.
#
# Idempotent and safe to re-run. Dry-run by default — pass --apply to delete.
#
# Requirements: bash, psql, GNU date, find. Reads:
#   DATABASE_URL           Postgres connection string (required unless --default-only)
#   BLOB_STORAGE_DIR       Blob root (default /data/blobs) — must match the services
#   DEFAULT_RETENTION_DAYS Fallback when a user has no org rule (default 90)
#
# Usage:
#   ./retention-cleanup.sh              # dry run, report what WOULD be deleted
#   ./retention-cleanup.sh --apply      # actually delete
#   ./retention-cleanup.sh --default-only --apply   # skip DB, prune everything
#                                       # older than DEFAULT_RETENTION_DAYS
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BLOB_DIR="${BLOB_STORAGE_DIR:-/data/blobs}"
PUNCH_DIR="${BLOB_DIR%/}/punch"
DEFAULT_RETENTION_DAYS="${DEFAULT_RETENTION_DAYS:-90}"

APPLY=0
DEFAULT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --apply)        APPLY=1 ;;
    --default-only) DEFAULT_ONLY=1 ;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

if [[ ! -d "$PUNCH_DIR" ]]; then
  log "No punch directory at $PUNCH_DIR — nothing to do."
  exit 0
fi

# Build a userId -> retention_days map. Without the DB (or --default-only) every
# user falls back to DEFAULT_RETENTION_DAYS.
declare -A RETENTION
if [[ "$DEFAULT_ONLY" -eq 0 && -n "${DATABASE_URL:-}" ]]; then
  log "Loading per-user retention from the database…"
  while IFS='|' read -r uid days; do
    [[ -n "$uid" ]] && RETENTION["$uid"]="${days:-$DEFAULT_RETENTION_DAYS}"
  done < <(psql "$DATABASE_URL" -Atq -c "
    SELECT u.id, COALESCE(r.image_retention_days, ${DEFAULT_RETENTION_DAYS})
    FROM iam.users u
    LEFT JOIN hr.attendance_rules r
      ON r.org_id = u.org_id AND r.is_active AND NOT r.is_deleted;
  ")
else
  log "Using DEFAULT_RETENTION_DAYS=${DEFAULT_RETENTION_DAYS} for every user (no DB lookup)."
fi

today_epoch=$(date -u +%s)
deleted=0
scanned=0

# Iterate each user's punch folder.
for userdir in "$PUNCH_DIR"/*/; do
  [[ -d "$userdir" ]] || continue
  uid="$(basename "$userdir")"
  days="${RETENTION[$uid]:-$DEFAULT_RETENTION_DAYS}"

  for f in "$userdir"*; do
    [[ -f "$f" ]] || continue
    scanned=$((scanned + 1))
    fname="$(basename "$f")"
    # Expect <YYYYMMDD>_chkin_<n>.jpg / <YYYYMMDD>_chkout_<n>.jpg (a split shift
    # punches several times a day). Only the leading date matters here.
    ymd="${fname%%_*}"
    if [[ ! "$ymd" =~ ^[0-9]{8}$ ]]; then
      log "SKIP (unrecognized name): $f"
      continue
    fi
    file_epoch=$(date -u -d "${ymd:0:4}-${ymd:4:2}-${ymd:6:2}" +%s 2>/dev/null || echo 0)
    [[ "$file_epoch" -eq 0 ]] && { log "SKIP (bad date): $f"; continue; }
    age_days=$(( (today_epoch - file_epoch) / 86400 ))
    if (( age_days > days )); then
      if (( APPLY )); then
        rm -f "$f" && deleted=$((deleted + 1))
      else
        log "WOULD DELETE (${age_days}d > ${days}d): $f"
        deleted=$((deleted + 1))
      fi
    fi
  done
  # Remove the user folder if it is now empty (apply mode only).
  if (( APPLY )); then rmdir "$userdir" 2>/dev/null || true; fi
done

if (( APPLY )); then
  log "Done. Scanned ${scanned}, deleted ${deleted}."
else
  log "Dry run. Scanned ${scanned}, ${deleted} eligible for deletion. Re-run with --apply."
fi
