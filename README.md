# msq-core — Platform core + parent workspace

Extracted from the `msq-platforms` monorepo per `docs/Phase5_Extraction_Plan.md`
(§2a). Owns: `identity-service`, `api-gateway`, `admin-service`,
`communication-service`, `auth-web`, `lookup-admin`, the `@platform/*`
packages, and the shared DB schemas (`iam`, `entity`, `geo`, `audit`).

**This repo doubles as the parent pnpm workspace root** (D5 Stage 1 — local
multi-repo dev, no registry). Clone the three product repos as subfolders
directly inside it:

```
msq-core/                (this repo)
  msq-lms/                (clone github.com/<org>/msq-lms here)
  msq-hrms/                (clone github.com/<org>/msq-hrms here)
  msq-todo/                (clone github.com/<org>/msq-todo here)
```

```bash
git clone <msq-core-url> msq-core
cd msq-core
git clone <msq-lms-url>  msq-lms
git clone <msq-hrms-url> msq-hrms
git clone <msq-todo-url> msq-todo
```

**Each subfolder is an independent git repo, not a submodule.** `msq-core`'s
own `.gitignore` excludes `/msq-lms/`, `/msq-hrms/`, `/msq-todo/` so their
presence never affects this repo's own history — clone, delete, or update
them independently at any time. `msq-core`'s `pnpm-workspace.yaml` globs
their `packages/*`/`services/*`/`apps/*` so pnpm symlinks `@platform/*` into
each product exactly as it did inside the original monorepo, once you run
`pnpm install` from `msq-core`'s root with all four repos present.

Each product repo also keeps its own `pnpm-workspace.yaml` (globbing only its
own `packages/*`/`services/*`/`apps/*`) so it can build standalone once
repointed at published `@platform/*` deps (D5 Stage 2/3, git-tag/registry).

## Status

This is a **Stage D extraction in progress**, not a finished standalone repo.
Known gaps, tracked rather than silently fixed:

- **`db_scripts/01_init-db.sql`, `10_init-hr-task-schemas.sql`,
  `17`–`20`, `22`, `23`, `25`** are still schema-interleaved (contain product
  `lms`/`hr`/`task`/`marketing`/`ext` DDL alongside the shared `iam`/`entity`/
  `geo`/`audit` DDL this repo owns) — kept whole rather than split, since
  splitting correctly requires statement-level parsing across a 3,340-line
  file with no live database to verify the cut against. Running this repo's
  `db_deploy.ps1` today still bootstraps the *entire* platform schema
  (all products), not just the shared one. Trimming these to the shared-only
  carve is a tracked follow-up — do it with a live DB to test against.
- **Cross-repo Docker networking is not wired.** `docker-compose.yml`'s
  `api-gateway` service reads `LEADS_SERVICE_URL`/`HR_SERVICE_URL`/etc. from
  `.env` with no default — point them at wherever `msq-lms`/`msq-hrms`/
  `msq-todo`'s containers actually run, or wire an external Docker network
  across all four repos' compose files.
- **This repo can still bootstrap the whole DB alone** (unlike the product
  repos, which cannot — see D4 in `docs/Platform_Architecture_Decisions.md`)
  precisely because `db_scripts` hasn't been trimmed yet. Once it is, this
  repo becomes the one that *must* run first (shared-first order, §3 of the
  extraction plan) and product repos assume its schemas already exist.
- **Docker image builds need this repo's root as build context**, not each
  product repo alone — e.g. `docker build -f msq-lms/services/leads-service/Dockerfile .`
  run from here, not from inside `msq-lms/`. Verified working this way; a
  standalone build from within a product repo fails to resolve `@platform/*`
  until Stage 2/3 (published packages) lands.
- **`turbo`/`depcruise`/`lint` for a product repo need that repo's own
  `pnpm install`, which breaks `@platform/*` resolution** — the workspace
  glob above only covers `packages/*`/`services/*`/`apps/*` per repo, not
  each repo's root `devDependencies` (`turbo`, `dependency-cruiser`). Verify
  a product repo's build/typecheck via `pnpm --filter "./msq-lms/**" run
  build|typecheck` from here instead.

## Local dev (Stage 1 — pnpm workspace, no registry)

```bash
# from msq-core/, with msq-lms/msq-hrms/msq-todo cloned alongside as above
pnpm install                       # links @platform/* into every product
make dev-infra                     # start Postgres (this repo's docker-compose)
make migrate                       # db_scripts/01_init-db.sql (bootstraps ALL schemas, see above)

pnpm --filter "./msq-lms/**" run build      # build a product's packages/services/apps
pnpm --filter "./msq-lms/**" run typecheck
```
