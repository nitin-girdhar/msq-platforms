# Loading and running shipped images on the server

Companion to `scripts/docker-ship.sh`. That script builds each service/app with
`docker compose build <service>` (which builds from the `pnpm deploy` output —
see each `Dockerfile` and `docs/Platform_Architecture_Decisions.md` D5) and
saves it to `dist/images/<service>-<tag>.tar.gz`. This doc covers getting
those archives onto the server and running them there, with **no repo clone,
no pnpm, no node_modules install** required server-side.

## 1. Copy the archives to the server

```bash
scp dist/images/*.tar.gz* deploy@server:/opt/crm/images/
```

Or `rsync -avz dist/images/ deploy@server:/opt/crm/images/` if shipping
repeatedly (only changed layers re-transfer at the docker-save-tarball level is
not incremental, so rsync mainly saves on the network round-trip, not bytes —
for real incremental transfer, push to a private registry instead).

## 2. Verify integrity (optional but recommended)

```bash
cd /opt/crm/images
sha256sum -c hr-service-latest.tar.gz.sha256
```

## 3. Load each image

```bash
for f in /opt/crm/images/*.tar.gz; do
  gunzip -c "$f" | docker load
done
```

`docker load` prints the loaded image name/tag, e.g. `Loaded image:
crm-hr-service:latest` — this must match the `image:`/service name your
server-side `docker-compose.yml` (or `docker run`) expects.

## 4. Run

If the server has its own `docker-compose.yml` + `.env` (recommended — keep
compose for service discovery, networks, and env wiring, just skip the
`build:` step since images are already loaded):

```bash
docker compose up -d
```

Compose will use the already-loaded local images instead of rebuilding, as
long as the image names match (project name `crm` from `docker-compose.yml`'s
top-level `name:` field) and no `--build`/`pull_policy: build` flag is passed.

For a single service without compose:

```bash
docker run -d --name hr-service \
  --env-file /opt/crm/.env \
  -p 4007:4007 \
  --network crm_default \
  crm-hr-service:latest
```

## 5. Rollback

Keep the previous archive/tag around (e.g. tag by git SHA instead of
`latest`: `IMAGE_TAG=$(git rev-parse --short HEAD) scripts/docker-ship.sh`).
To roll back: `docker load` the old tarball again, then
`docker compose up -d <service>` (or `docker run` with the old tag) — no
rebuild needed.

## Notes

- Each image is fully self-contained (built via `pnpm --filter <pkg> deploy
  --prod`), so the server never needs pnpm, the workspace lockfile, or network
  access to install dependencies.
- Next.js apps bake `NEXT_PUBLIC_*` origins into the client bundle at **build**
  time (see the `ARG`/`ENV` lines in `apps/*/Dockerfile`) — changing them
  requires rebuilding and re-shipping the image, not just restarting the
  container with new env vars.
- `docker save | gzip` ships the full image (base OS layers included) even
  though most of it is already on the server from a prior deploy; Docker's
  local layer cache still dedupes on `docker load` (`docker load` will report
  "The image ... already exists" for those layers and be fast).
