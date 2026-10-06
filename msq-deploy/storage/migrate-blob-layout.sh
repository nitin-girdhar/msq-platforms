#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Move stored files from the legacy blob layout to the tenant-first layout.
#
#   avatar/<user>/<ts>.<ext>              → <tenant>/<branch>/<user>/avatar/<ts>.<ext>
#   punch/<user>/<YYYYMMDD>_<k>_<n>.<ext> → <tenant>/<branch>/<user>/punches/<YYYY>/<MM>/<same name>
#   documents/<org>/<user>/<id>.<ext>     → <tenant>/<branch>/<user>/documents/<id>.<ext>
#   leave/<org>/<user>/<id>.<ext>         → <tenant>/<branch>/<user>/leave/<id>.<ext>
#   brand/<tenant>/<slot>/<ts>.<ext>      → <tenant>/branding/<slot>/<ts>.<ext>
#
# branch = the org the row belongs to (iam.users.org_id for avatars; the row's own
# org_id for punches, documents and leave); tenant = that org's tenant.
#
# Safe by construction — every DB pointer is the source of truth, so old and new keys
# coexist and nothing breaks mid-way:
#   (default)         DRY RUN. Lists what would move; writes nothing.
#   --apply           1. COPIES each file (never moves) and verifies it by sha256;
#                     2. repoints every pointer whose copy verified, in ONE transaction
#                        (all or nothing). Old files stay in place.
#   --purge-legacy    Deletes an old file only when the DB now points at the new key AND
#                     the new file exists with the same hash. Run after a grace period.
# Orphans (a legacy file no row references) are reported, never touched.
#
# Needs: bash, sha256sum, and a way to run psql. Set one of:
#   DATABASE_URL=postgres://…                      (psql on PATH), or
#   PSQL_CMD="docker exec -i msq-db-server psql -U postgres -d platforms"
#   BLOB_STORAGE_DIR   blob root (default /data/blobs) — the SAME folder the services mount.
#   MAP_FILE           mapping file (default ./blob-layout-migration.tsv); --purge-legacy reads it.
#
# Take a backup of the blob volume AND the database before --apply (they must be restored
# together). Run per environment; turn BLOB_ALLOW_LEGACY_KEYS=false on the services only
# after --purge-legacy has completed there.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BLOB_DIR="${BLOB_STORAGE_DIR:-/data/blobs}"
BLOB_DIR="${BLOB_DIR%/}"
MAP_FILE="${MAP_FILE:-./blob-layout-migration.tsv}"
MODE=dry
for arg in "$@"; do
  case "$arg" in
    --apply)         MODE=apply ;;
    --purge-legacy)  MODE=purge ;;
    -h|--help)       grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

if [[ -n "${PSQL_CMD:-}" ]]; then
  # shellcheck disable=SC2206
  PSQL=($PSQL_CMD)
elif [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL=(psql "$DATABASE_URL")
else
  echo "Set DATABASE_URL or PSQL_CMD" >&2; exit 2
fi
# </dev/null: psql / docker exec must never read the caller's stdin, or it swallows the rest of a
# `while read` loop that is feeding this function.
q() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -Atq -F $'\t' "$@" </dev/null; }

UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
SAFE_RE='^[A-Za-z0-9][A-Za-z0-9/_.-]*$'
sha() { sha256sum "$1" | cut -d' ' -f1; }

# Candidate rows: kind <TAB> table <TAB> id-or-tenant <TAB> old_key <TAB> new_key
# (new_key is computed in SQL so the rule lives in one place).
candidates() {
  q -c "
    SELECT 'avatar', 'iam.users', u.id::text, u.photo_key,
           o.tenant_id || '/' || u.org_id || '/' || u.id || '/avatar/' || regexp_replace(u.photo_key, '^.*/', '')
    FROM iam.users u JOIN entity.organizations o ON o.id = u.org_id
    WHERE u.photo_key LIKE 'avatar/%'
    UNION ALL
    SELECT 'punch', 'hr.attendance_events', e.id::text, e.photo_url,
           o.tenant_id || '/' || e.org_id || '/' || e.user_id || '/punches/' ||
             substr(regexp_replace(e.photo_url, '^.*/', ''), 1, 4) || '/' || substr(regexp_replace(e.photo_url, '^.*/', ''), 5, 2) || '/' ||
             regexp_replace(e.photo_url, '^.*/', '')
    FROM hr.attendance_events e JOIN entity.organizations o ON o.id = e.org_id
    WHERE e.photo_url LIKE 'punch/%'
    UNION ALL
    SELECT 'document', 'hr.employee_documents', d.id::text, d.file_key,
           o.tenant_id || '/' || d.org_id || '/' || d.user_id || '/documents/' || regexp_replace(d.file_key, '^.*/', '')
    FROM hr.employee_documents d JOIN entity.organizations o ON o.id = d.org_id
    WHERE d.file_key LIKE 'documents/%'
    UNION ALL
    SELECT 'leave', 'hr.leave_requests', l.id::text, l.attachment_key,
           o.tenant_id || '/' || l.org_id || '/' || l.user_id || '/leave/' || regexp_replace(l.attachment_key, '^.*/', '')
    FROM hr.leave_requests l JOIN entity.organizations o ON o.id = l.org_id
    WHERE l.attachment_key LIKE 'leave/%'
    UNION ALL
    SELECT 'brand', 'entity.tenant_branding', b.tenant_id::text || '|' || a.slot, a.meta->>'key',
           b.tenant_id || '/branding/' || a.slot || '/' || regexp_replace(a.meta->>'key', '^.*/', '')
    FROM entity.tenant_branding b, LATERAL jsonb_each(b.assets) AS a(slot, meta)
    WHERE a.meta->>'key' LIKE 'brand/%'
    ORDER BY 1, 3;
  "
}

# SQL that repoints one verified row (identifiers are validated before use).
update_sql() { # kind id old new
  local kind="$1" id="$2" old="$3" new="$4"
  case "$kind" in
    avatar)   printf "UPDATE iam.users SET photo_key = '%s' WHERE id = '%s' AND photo_key = '%s';\n" "$new" "$id" "$old" ;;
    punch)    printf "UPDATE hr.attendance_events SET photo_url = '%s' WHERE id = '%s' AND photo_url = '%s';\n" "$new" "$id" "$old" ;;
    document) printf "UPDATE hr.employee_documents SET file_key = '%s' WHERE id = '%s' AND file_key = '%s';\n" "$new" "$id" "$old" ;;
    leave)    printf "UPDATE hr.leave_requests SET attachment_key = '%s' WHERE id = '%s' AND attachment_key = '%s';\n" "$new" "$id" "$old" ;;
    brand)    printf "UPDATE entity.tenant_branding SET assets = jsonb_set(assets, '{%s,key}', to_jsonb('%s'::text)) WHERE tenant_id = '%s' AND assets->'%s'->>'key' = '%s';\n" "${id#*|}" "$new" "${id%%|*}" "${id#*|}" "$old" ;;
  esac
}

# ── purge ────────────────────────────────────────────────────────────────────
if [[ "$MODE" == purge ]]; then
  [[ -f "$MAP_FILE" ]] || { echo "No mapping file at $MAP_FILE — run --apply first." >&2; exit 1; }
  purged=0; kept=0
  while IFS=$'\t' read -r kind table id old new; do
    [[ -n "$old" ]] || continue
    # The DB must point at the new key, and the new file must match the old one.
    case "$kind" in
      avatar)   still=$(q -c "SELECT count(*) FROM iam.users WHERE id = '$id' AND photo_key = '$new'") ;;
      punch)    still=$(q -c "SELECT count(*) FROM hr.attendance_events WHERE id = '$id' AND photo_url = '$new'") ;;
      document) still=$(q -c "SELECT count(*) FROM hr.employee_documents WHERE id = '$id' AND file_key = '$new'") ;;
      leave)    still=$(q -c "SELECT count(*) FROM hr.leave_requests WHERE id = '$id' AND attachment_key = '$new'") ;;
      brand)    still=$(q -c "SELECT count(*) FROM entity.tenant_branding WHERE tenant_id = '${id%%|*}' AND assets->'${id#*|}'->>'key' = '$new'") ;;
      *)        still=0 ;;
    esac
    if [[ "$still" == 1 && -f "$BLOB_DIR/$new" && -f "$BLOB_DIR/$old" && "$(sha "$BLOB_DIR/$new")" == "$(sha "$BLOB_DIR/$old")" ]]; then
      rm -f "$BLOB_DIR/$old"; purged=$((purged + 1))
    else
      [[ -f "$BLOB_DIR/$old" ]] && { log "KEEP (not verified): $old"; kept=$((kept + 1)); }
    fi
  done < "$MAP_FILE"
  # Drop legacy folders that are now empty.
  find "$BLOB_DIR/avatar" "$BLOB_DIR/punch" "$BLOB_DIR/documents" "$BLOB_DIR/leave" "$BLOB_DIR/brand" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  log "Purge done. Deleted ${purged} legacy file(s), kept ${kept}."
  exit 0
fi

# ── dry-run / apply ──────────────────────────────────────────────────────────
log "Blob root: $BLOB_DIR   mode: $MODE"
moved=0; missing=0; bad=0; already=0
: > "$MAP_FILE.tmp"
SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT
{ echo "BEGIN;"; } > "$SQL_FILE"

while IFS=$'\t' read -r kind table id old new; do
  [[ -n "$old" ]] || continue
  # Strict shape checks: nothing odd ever reaches a path or a SQL string.
  if [[ ! "$old" =~ $SAFE_RE || ! "$new" =~ $SAFE_RE || "$old" == *..* || "$new" == *..* ]]; then
    log "SKIP (unsafe key): $old"; bad=$((bad + 1)); continue
  fi
  if [[ "$kind" != brand && ! "${id}" =~ $UUID_RE ]]; then log "SKIP (bad id): $id"; bad=$((bad + 1)); continue; fi
  if [[ ! -f "$BLOB_DIR/$old" ]]; then
    log "MISSING file for ${kind} ${id}: $old"; missing=$((missing + 1)); continue
  fi
  if [[ "$MODE" == dry ]]; then
    log "WOULD COPY [$kind] $old -> $new"; moved=$((moved + 1)); continue
  fi
  mkdir -p "$(dirname "$BLOB_DIR/$new")"
  if [[ -f "$BLOB_DIR/$new" ]]; then already=$((already + 1)); else cp -n "$BLOB_DIR/$old" "$BLOB_DIR/$new"; fi
  if [[ "$(sha "$BLOB_DIR/$old")" != "$(sha "$BLOB_DIR/$new")" ]]; then
    log "HASH MISMATCH, not repointing: $old"; bad=$((bad + 1)); continue
  fi
  update_sql "$kind" "$id" "$old" "$new" >> "$SQL_FILE"
  printf '%s\t%s\t%s\t%s\t%s\n' "$kind" "$table" "$id" "$old" "$new" >> "$MAP_FILE.tmp"
  moved=$((moved + 1))
done < <(candidates)

if [[ "$MODE" == dry ]]; then
  rm -f "$MAP_FILE.tmp"
  log "Dry run: ${moved} file(s) would be copied and repointed; ${missing} missing on disk; ${bad} skipped. Re-run with --apply."
  # Orphans: legacy files no row references (reported only).
  for d in avatar punch documents leave brand; do
    [[ -d "$BLOB_DIR/$d" ]] || continue
    n=$(find "$BLOB_DIR/$d" -type f | wc -l); log "legacy folder $d/: ${n} file(s) on disk"
  done
  exit 0
fi

echo "COMMIT;" >> "$SQL_FILE"
if (( moved > 0 )); then
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q < "$SQL_FILE" >/dev/null
fi
# Keep any earlier mapping lines (a re-run only adds), de-duplicated.
[[ -f "$MAP_FILE" ]] && cat "$MAP_FILE" >> "$MAP_FILE.tmp"
sort -u "$MAP_FILE.tmp" > "$MAP_FILE" && rm -f "$MAP_FILE.tmp"
log "Applied: ${moved} pointer(s) repointed (${already} copy already present); ${missing} missing on disk; ${bad} skipped."
log "Old files are still on disk. After a grace period run: $0 --purge-legacy"
