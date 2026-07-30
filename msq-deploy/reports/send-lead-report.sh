#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Daily lead report — production runner.
#
# Runs the job INSIDE the leads-service container, on the compose network. That
# is the whole point of this wrapper: the job POSTs to communication-service,
# which is `expose`d and not published, so it exists only as
# http://communication-service:4005 on that network. This is the identical path
# the live "send WhatsApp to lead" feature already uses — compose sets
# COMMUNICATION_SERVICE_URL on the leads-service container (docker-compose.yml),
# and running in-container inherits it. A host-side `pnpm send-lead-report`
# cannot reach the service and fails every tenant on connect.
#
# Because the container supplies its own environment from artifacts/.env, NO
# secrets are passed on the command line and none end up in the crontab.
#
# Requires the image to contain dist/jobs/send-lead-report.js — i.e. built from a
# commit that includes the job. `pnpm deploy --prod` prunes devDependencies, so
# tsx is absent from the image and the job must run as plain node against dist/
# (the `send-lead-report:prod` package script). Rebuild the image if the
# preflight below reports the job is missing.
#
# Reads:
#   COMPOSE_DIR    dir holding docker-compose.yml + .env
#                  (default: <repo>/msq-deploy/artifacts)
#   COMPOSE_FILE   compose file name (default: docker-compose.yml)
#   LEADS_SERVICE  compose service name (default: leads-service)
#   RUN_MODE       "run" (default, fresh one-off container) or "exec"
#                  (reuse the running service container)
#
# Usage:
#   ./send-lead-report.sh                      # every LMS tenant
#   ./send-lead-report.sh --dry-run            # render + print, send nothing
#   ./send-lead-report.sh --tenant=<uuid>
#   RUN_MODE=exec ./send-lead-report.sh        # reuse the live container
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${MSQ_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
COMPOSE_DIR="${COMPOSE_DIR:-$REPO_DIR/msq-deploy/artifacts}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
LEADS_SERVICE="${LEADS_SERVICE:-leads-service}"
RUN_MODE="${RUN_MODE:-run}"
JOB_ENTRY="dist/jobs/send-lead-report.js"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 2; }

command -v docker >/dev/null 2>&1 || die "docker not found on PATH (cron has a bare PATH; set NODE_BIN_DIR/PATH or use an absolute docker path)."
[[ -f "$COMPOSE_DIR/$COMPOSE_FILE" ]] || die "no $COMPOSE_FILE in $COMPOSE_DIR. Set COMPOSE_DIR."
[[ -f "$COMPOSE_DIR/.env" ]] || die "no .env in $COMPOSE_DIR — the container would start without DB or SMTP settings."

cd "$COMPOSE_DIR"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

# Preflight: a missing job file is the one failure that looks like success —
# `node` on a nonexistent path exits non-zero with a bare MODULE_NOT_FOUND that
# reads like a crash rather than "your image is stale". Name it plainly.
if ! "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh "$LEADS_SERVICE" \
      -c "[ -f $JOB_ENTRY ]" >/dev/null 2>&1; then
  # Build context is the MONOREPO ROOT, not msq-lms: the Dockerfile's
  # `COPY . .` + `pnpm install` needs the root pnpm-workspace.yaml and the
  # @platform/* packages under msq-core.
  die "$JOB_ENTRY is missing from the $LEADS_SERVICE image. Rebuild it from a commit that includes src/jobs/send-lead-report.ts:
     (cd $REPO_DIR && docker build -f msq-lms/services/leads-service/Dockerfile -t msq-leads-service .)
     then: (cd $COMPOSE_DIR && docker compose -f $COMPOSE_FILE up -d $LEADS_SERVICE)"
fi

log "Running daily lead report in-container (mode=$RUN_MODE, service=$LEADS_SERVICE, args=${*:-none})"

if [[ "$RUN_MODE" == "exec" ]]; then
  # -T: no TTY. Without it, cron (no terminal) makes docker exec fail outright.
  exec "${COMPOSE[@]}" exec -T "$LEADS_SERVICE" node "$JOB_ENTRY" "$@"
fi

# --no-deps so a report run never starts or restarts the API stack as a
# side effect; --rm so repeated cron runs do not accumulate dead containers.
exec "${COMPOSE[@]}" run --rm --no-deps "$LEADS_SERVICE" node "$JOB_ENTRY" "$@"
