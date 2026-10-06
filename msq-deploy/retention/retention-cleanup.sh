#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Attendance selfie retention cleanup.
#
# Deletes daily check-in/out selfies (blob keys `<tenant>/<branch>/<employee>/punches/<YYYY>/<MM>/<YYYYMMDD>_*.jpg`,
# and the legacy `punch/<userId>/<YYYYMMDD>_*.jpg` until the layout migration has run)
# once they are older than the owning org's `hr.attendance_rules.image_retention_days`.
# The enrolled reference photo (`…/avatar/**`, legacy `avatar/**`) is NEVER touched.
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

# Two layouts coexist until msq-deploy/storage/migrate-blob-layout.sh has moved the old files:
#   legacy:  <root>/punch/<userId>/<YYYYMMDD>_<kind>_<n>.<ext>
#   current: <root>/<tenantId>/<branchId>/<employeeId>/punches/<YYYY>/<MM>/<YYYYMMDD>_<kind>_<n>.<ext>
if [[ ! -d "$PUNCH_DIR" ]] && ! compgen -G "${BLOB_DIR%/}/*/*/*/punches" >/dev/null; then
  log "No punch folders under $BLOB_DIR — nothing to do."
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

# Age-check one selfie. $1 = path, $2 = employee/user id. Only the LEADING date of the
# file name matters (<YYYYMMDD>_chkin_<n>.jpg; a split shift punches several times a day).
check_file() {
  local f="$1" uid="$2" fname ymd file_epoch age_days days
  [[ -f "$f" ]] || return 0
  scanned=$((scanned + 1))
  days="${RETENTION[$uid]:-$DEFAULT_RETENTION_DAYS}"
  fname="$(basename "$f")"
  ymd="${fname%%_*}"
  if [[ ! "$ymd" =~ ^[0-9]{8}$ ]]; then
    log "SKIP (unrecognized name): $f"
    return 0
  fi
  file_epoch=$(date -u -d "${ymd:0:4}-${ymd:4:2}-${ymd:6:2}" +%s 2>/dev/null || echo 0)
  if [[ "$file_epoch" -eq 0 ]]; then log "SKIP (bad date): $f"; return 0; fi
  age_days=$(( (today_epoch - file_epoch) / 86400 ))
  if (( age_days > days )); then
    if (( APPLY )); then
      rm -f "$f" && deleted=$((deleted + 1))
    else
      log "WOULD DELETE (${age_days}d > ${days}d): $f"
      deleted=$((deleted + 1))
    fi
  fi
  return 0
}

# Legacy layout: one folder per user.
if [[ -d "$PUNCH_DIR" ]]; then
  for userdir in "$PUNCH_DIR"/*/; do
    [[ -d "$userdir" ]] || continue
    uid="$(basename "$userdir")"
    for f in "$userdir"*; do check_file "$f" "$uid"; done
    # Remove the user folder if it is now empty (apply mode only).
    if (( APPLY )); then rmdir "$userdir" 2>/dev/null || true; fi
  done
fi

# Current layout. The path shape is matched strictly (UUID segments + 'punches'), so
# nothing outside a person's punches folder — avatar/, documents/, leave/, branding/ —
# can ever be reached by this script.
UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
PATH_RE="^(${UUID_RE})/(${UUID_RE})/(${UUID_RE})/punches/[0-9]{4}/[0-9]{2}/[^/]+$"
while IFS= read -r -d '' f; do
  rel="${f#"${BLOB_DIR%/}/"}"
  if [[ "$rel" =~ $PATH_RE ]]; then
    check_file "$f" "${BASH_REMATCH[3]}"
  fi
done < <(find "${BLOB_DIR%/}" -mindepth 7 -maxdepth 7 -type f -path '*/punches/*' -print0 2>/dev/null)
# Tidy empty month / year folders left behind (apply mode only).
if (( APPLY )); then
  find "${BLOB_DIR%/}" -mindepth 5 -maxdepth 6 -type d -empty -path '*/punches/*' -delete 2>/dev/null || true
fi

if (( APPLY )); then
  log "Done. Scanned ${scanned}, deleted ${deleted}."
else
  log "Dry run. Scanned ${scanned}, ${deleted} eligible for deletion. Re-run with --apply."
fi
