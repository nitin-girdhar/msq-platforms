# MSQ platform — Linux deployment runbook

Steps to run **on the Linux target machine**, using the bundle produced by
`msq-deploy/build-deploy.ps1` on the Windows build host.

The bundle is self-contained: it ships pre-built Docker images as a tar, so the
target needs **no source code, no Node, no pnpm, and no network access to a
registry** — only Docker.

---

## 0. What you should have copied over

The `msq-deploy/artifacts/` folder, in full:

```
artifacts/
  docker-compose.yml      # merged, single `msq` compose project (all 4 repos)
  .env.example            # merged env template — every key the stack reads
  deploy.sh               # installer / updater
  bootstrap-db.sh         # post-schema DB sequence (lookups, seed, migrations)
  msq-images.tar          # ~3.4 GB — all service + web + postgres images
  db_scripts/
    01..13_*.sql
    _migrations/          # ← must be present: 17 and 19 are mandatory
```

> **Check `db_scripts/_migrations/` exists before you start.** Without
> `17_tenant_scope_lms_catalogs.sql` the tenant-scoped RLS in `06_rls.sql` hides
> every LMS lead catalog row, and Status / Outcome / Lead Source / Follow-up
> render blank for every user except `super_admin`.

Transfer by USB or:

```bash
scp -r artifacts/ user@target:~/msq-artifacts/
```

---

## 1. Prerequisites on the target

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
docker --version && docker compose version
```

Also confirm:

- **Disk**: ≥ 25 GB free (`df -h`) — the image tar alone is ~3.4 GB, and it
  roughly doubles while loading.
- **Ports free**: 3000, 3001, 3002, 3003, 3005, 4000, and whatever `DB_PORT`
  you set (`sudo ss -tlnp | grep -E ':(3000|3001|3002|3003|3005|4000|5432)'`).

---

## 2. First run — creates `.env` and stops

```bash
cd ~/msq-artifacts
chmod +x deploy.sh bootstrap-db.sh
sudo ./deploy.sh
```

This creates `/opt/msq/`, copies the compose file and `db_scripts/`, writes
`/opt/msq/.env` from the example, and **exits on purpose** so you can edit the
config first.

It stops rather than continuing because Postgres applies the bootstrap schema
**only on the first boot of an empty data directory** — starting the stack with
placeholder credentials would bake them in, and fixing it means wiping the data
directory and starting over.

---

## 3. Edit `/opt/msq/.env`

```bash
sudo nano /opt/msq/.env
```

Must change:

| Key | Why |
|---|---|
| `DB_DATA_PATH` | The example is a Windows path (`C:/Girdhar/database_files`) and is invalid here. Set `/opt/msq/data/postgres`. |
| `POSTGRES_PASSWORD` | Superuser password — baked into the DB on first boot. |
| `DB_SERVICE_PASSWORD` and the other `DB_*_SVC_PASSWORD` values | See the warning below — these are **hardcoded in the SQL** and must be changed in both places. |
| JWT / session / cookie secrets | Never ship the example values. |
| `NEXT_PUBLIC_*` URLs | These are **browser-facing**. If anyone reaches the app from another machine, `localhost` will not work — use the host's IP or DNS name. |

> **Service-role passwords live in two places and must agree.** The DB login
> roles are created with literal passwords inside the SQL, not from `.env`:
>
> | Role | Created in | `.env` key |
> |---|---|---|
> | `root_service` | `01_extensions_and_roles.sql:105` | `DB_SERVICE_PASSWORD` |
> | `lead_svc` | `02_schema.sql:2435` | `DB_LEAD_SVC_PASSWORD` |
> | `tenant_dash_svc` | `02_schema.sql:2475` | `DB_TENANT_SVC_PASSWORD` |
> | `meta_svc` | `02_schema.sql:3707` | `DB_META_SVC_PASSWORD` |
> | `hr_svc` | `03_product_schema.sql:49` | `DB_HR_SVC_PASSWORD` |
> | `task_svc` | `03_product_schema.sql:57` | `DB_TASK_SVC_PASSWORD` |
> | `lms_svc` | `04_roles_and_grants.sql:495` | `DB_LMS_SVC_PASSWORD` |
>
> To rotate these for a real deployment, edit the SQL **before** the first
> `docker compose up` (the init hook runs once), and set the matching `.env`
> keys to the same values. Several other roles in `02_schema.sql` are created
> with the placeholder `'replace_in_env'` and are unused by the shipped
> services — leave them unless you wire something to them.

Worth reviewing:

- `DB_PORT` — only needs publishing if you want to reach Postgres from outside
  the compose network.
- `DB_NAME`, `DB_CONTAINER_NAME` — `bootstrap-db.sh` reads both from this file.
- `LEADS_SERVICE_URL` / `HR_SERVICE_URL` / `TASKS_SERVICE_URL` / etc. — in the
  merged bundle all four repos are one compose project on one network, so these
  resolve by service name (`http://leads-service:PORT`).

---

## 4. Second run — the actual deployment

```bash
sudo ./deploy.sh              # schema + lookup data + demo tenants/orgs/users
# or
sudo ./deploy.sh --no-seed    # schema + lookup data only, no demo rows
```

What happens, in order:

1. `docker load` of `msq-images.tar` (several minutes).
2. `docker compose up -d` — Postgres starts and, on this first boot, applies
   `db_scripts/01`–`06` from `/docker-entrypoint-initdb.d/`: extensions, roles,
   the shared `iam`/`entity`/`geo`/`audit` schema, the product `lms`/`hr`/`task`
   schema, grants, catalogs, and RLS.
3. `bootstrap-db.sh` runs everything Postgres' init hook does **not** cover:

   | Script | |
   |---|---|
   | `07_seed_lookup_data.sql` | Lookup/catalog data. Always. |
   | `08`–`12c` | Demo tenants, orgs, users, leads, interactions + cleanup. Skipped with `--no-seed`. |
   | `13_backfill_per_product_roles.sql` | Per-product role backfill. |
   | `_migrations/17_tenant_scope_lms_catalogs.sql` | **Mandatory.** Fans the global LMS lead catalogs out into one copy per tenant. |
   | `_migrations/19_tenant_scope_ladder_roles.sql` | **Mandatory.** Same for the ladder roles + their capability grants. |

   17 and 19 run *last* because they need `entity.tenants` populated — script 07
   seeds those rows as global (`tenant_id IS NULL`) before any tenant exists.
   Both are idempotent and self-guarding: with no tenants they find nothing to
   clone and do nothing.

4. Dangling images pruned, endpoints printed.

---

## 5. Verify

```bash
cd /opt/msq
docker compose ps                      # every service Up, postgres healthy
docker compose logs -f api-gateway     # Ctrl-C to exit
```

Database sanity check — the catalogs should be **tenant-scoped, not global**:

```bash
source /opt/msq/.env
docker exec -it "$DB_CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$DB_NAME" -c \
  "SELECT count(*) FILTER (WHERE tenant_id IS NULL) AS global_rows,
          count(*) FILTER (WHERE tenant_id IS NOT NULL) AS tenant_rows
   FROM lms.lead_stage;"
```

`global_rows` must be **0**. If it isn't, migration 17 did not run — re-run
`sudo INSTALL_DIR=/opt/msq bash /opt/msq/bootstrap-db.sh`.

Then in a browser:

| App | URL |
|---|---|
| Auth web | `http://<host>:3000` |
| LMS web | `http://<host>:3001` |
| HR web | `http://<host>:3002` |
| Todo web | `http://<host>:3003` |
| Lookup admin | `http://<host>:3005` |
| API gateway | `http://<host>:4000` |

Log in as a seeded user and confirm the LMS lead list shows **Status, Outcome,
Lead Source and Follow-up populated** — those going blank is the classic symptom
of migration 17 having been skipped.

---

## 6. Updating later

```bash
# copy the new artifacts/ over, then:
cd ~/msq-artifacts
sudo ./deploy.sh --redeploy
```

`--redeploy` loads the new images, restarts the stack, and **leaves the database
alone** — it does not re-seed. If the schema changed, apply the new SQL yourself
and then re-run the post-schema sequence:

```bash
sudo INSTALL_DIR=/opt/msq bash /opt/msq/bootstrap-db.sh --no-seed
```

---

## Troubleshooting

**Services can't connect to the database** (`password authentication failed`).
The `DB_*_SVC_PASSWORD` values in `.env` don't match the literals the SQL created
those roles with — see the table in §3. Check which role is failing:
```bash
cd /opt/msq && docker compose logs identity-service | grep -i 'password\|auth'
```
Fix without a full rebuild by resetting the role in the DB to match `.env`:
```bash
source /opt/msq/.env
docker exec -it "$DB_CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$DB_NAME" -c \
  "ALTER ROLE lead_svc WITH PASSWORD '$DB_LEAD_SVC_PASSWORD';"
```

**Schema is missing entirely / Postgres started clean but empty.**
The init hook only fires on an empty data directory. If `DB_DATA_PATH` already
had content, `01`–`06` never ran. Wipe and redo:
```bash
cd /opt/msq && docker compose down
sudo rm -rf /opt/msq/data/postgres/*
docker compose up -d && sudo INSTALL_DIR=/opt/msq bash /opt/msq/bootstrap-db.sh
```

**`bootstrap-db.sh` fails on some script.**
It runs with `ON_ERROR_STOP=1`, so psql prints the exact file and line before
stopping and nothing after that point was applied. Fix the cause and re-run the
whole script — every step is idempotent.

**pgvector warning during `01`.**
Expected. The stock `postgres:18.4` image has no pgvector; `01` catches it and
raises a warning rather than failing. AI embedding features stay disabled.

**Blank Status / Outcome / Source / Follow-up in the LMS UI.**
Migration 17 did not run. See the verification query in §5.

**Platform-tier pages 403 or show "404 This page could not be found".**
`iam.users.platform_role` is stale or NULL. On a fresh install the trigger in
`02_schema.sql` prevents this; on a database created before that trigger existed,
apply the repair:
```bash
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER_NAME" \
  psql -U "$POSTGRES_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  < /opt/msq/db_scripts/_migrations/18_platform_role_autoderive.sql
```

**Migrating a pre-P1.0 database (schema still named `crm`, role `crm_service`).**
Do **not** use this bundle's fresh-install path. Run `_migrations/15` then `16`
against the live database first — see `db_scripts/_migrations/README.md`.
