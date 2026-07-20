#!/usr/bin/env bash
# Build one or more docker-compose services and package them for offline
# shipping to a server that has no access to this repo or a registry.
#
# Usage:
#   scripts/docker-ship.sh                       # build + package every app/service
#   scripts/docker-ship.sh hr-service lms-web    # build + package specific services
#
# Output: dist/images/<service>-<tag>.tar.gz (+ .sha256) for each image, built
# from `docker compose build <service>` so the image name/tag always matches
# what `docker-load.md` expects on the server (project name "crm" from
# docker-compose.yml, e.g. crm-hr-service:latest).
#
# See docs/Platform_Architecture_Decisions.md (D5) for why this ships whole
# images rather than re-running `pnpm deploy` on the server: the server never
# needs the monorepo source, lockfile, or a pnpm store.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE_PROJECT="crm"
OUT_DIR="dist/images"
TAG="${IMAGE_TAG:-latest}"

ALL_SERVICES=(
  identity-service
  leads-service
  notifications-service
  communication-service
  meta-conversion-api
  admin-service
  hr-service
  tasks-service
  api-gateway
  auth-web
  lms-web
  hr-web
  todo-web
  lookup-admin
)

services=("$@")
if [ "${#services[@]}" -eq 0 ]; then
  services=("${ALL_SERVICES[@]}")
fi

mkdir -p "$OUT_DIR"

for svc in "${services[@]}"; do
  image="${COMPOSE_PROJECT}-${svc}:${TAG}"
  archive="${OUT_DIR}/${svc}-${TAG}.tar.gz"

  echo "==> Building ${image}"
  docker compose build "$svc"

  echo "==> Saving ${image} -> ${archive}"
  docker save "$image" | gzip > "$archive"
  sha256sum "$archive" > "${archive}.sha256"

  echo "==> $(du -h "$archive" | cut -f1) written"
done

echo
echo "Done. Copy dist/images/*.tar.gz(.sha256) to the server, then follow scripts/docker-load.md."
