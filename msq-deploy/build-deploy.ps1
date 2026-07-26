<#
.SYNOPSIS
    Builds every MSQ repo's Docker images and packages one deployment bundle for Linux.

.DESCRIPTION
    Discovers the platform root repo plus every child product repo (any subfolder
    holding a docker-compose-linux.yml) and, for the whole set:

    1. Builds images   - docker compose build, per repo
    2. Merges compose  - all docker-compose-linux.yml files into ONE compose file
                         via `docker compose config --no-interpolate`, which keeps
                         ${VAR} placeholders unresolved so the bundle is still
                         configured on the server, not on this build host
    3. Merges env      - every .env.example into one, deduped, first repo wins
    4. Exports images  - the merged compose file's full image set into a single
                         uncompressed .tar (no gzip: docker save layers are
                         already compressed)
    5. Copies db_scripts and generates deploy.sh

    Because all repos declare `name: msq`, the merge yields a single compose
    project and therefore a single default network - which is what makes the
    cross-repo service DNS (api-gateway -> leads-service, hr-service, ...)
    resolve on the server.

.EXAMPLE
    .\msq-deploy\build-deploy.ps1
    .\msq-deploy\build-deploy.ps1 -SkipBuild            # repackage without rebuilding
    .\msq-deploy\build-deploy.ps1 -Repos msq-core,msq-lms   # subset of child repos
#>
param(
    [switch]$SkipBuild,
    [string[]]$Repos
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -- Paths --------------------------------------------------------------------
$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$ArtifactsDir = Join-Path $PSScriptRoot 'artifacts'
$DbScriptsDst = Join-Path $ArtifactsDir 'db_scripts'
$TarFile      = Join-Path $ArtifactsDir 'msq-images.tar'
$ComposeDst   = Join-Path $ArtifactsDir 'docker-compose.yml'
$EnvDst       = Join-Path $ArtifactsDir '.env.example'

# Schema scripts docker-compose-linux.yml mounts at first boot. Seed/cleanup
# scripts (07+) ship too but stay opt-in - run them by hand.
$SchemaScripts = @(
    '01_extensions_and_roles.sql'
    '02_schema.sql'
    '03_product_schema.sql'
    '04_roles_and_grants.sql'
    '05_catalogs.sql'
    '06_rls.sql'
)

# Migrations that are part of EVERY install, not just pre-P1.0 upgrades. They
# run after the demo seed because they need entity.tenants populated - they fan
# rows that 07 seeds as GLOBAL (tenant_id IS NULL) out into one copy per tenant.
# Mirrors $RemainingCoreScripts in db_scripts/db_deploy.ps1; keep the two in sync.
$MigrationScripts = @(
    '17_tenant_scope_lms_catalogs.sql'
    '19_tenant_scope_ladder_roles.sql'
)

# -- Helpers ------------------------------------------------------------------
function Write-Step([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

function Invoke-Native([scriptblock]$block, [string]$failMessage) {
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $block } finally { $ErrorActionPreference = $savedEAP }
    if ($LASTEXITCODE -ne 0) { Write-Error $failMessage }
}

# Windows PowerShell 5.1's Get-Content decodes a BOM-less file using the ANSI
# codepage (CP1252), NOT UTF-8. Every box-drawing char in the .env.example
# comment banners (U+2500 '-' = E2 94 80) therefore came back as three CP1252
# chars, and WriteAllText re-encoded each of those as UTF-8 - turning one 3-byte
# char into 6 bytes of mojibake that the merged bundle then shipped.
# .NET's ReadAllText defaults to UTF-8 and honours a BOM if present.
function Read-Utf8Text([string]$Path) {
    return [System.IO.File]::ReadAllText($Path)
}

function Get-NativeOutput([scriptblock]$block) {
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = & $block 2>$null } finally { $ErrorActionPreference = $savedEAP }
    return $out
}

# `docker compose config` resolves every relative path (bind-mount sources,
# env_file entries) to an ABSOLUTE path on THIS build host - e.g.
# `C:\Girdhar\...\db_scripts\02_schema.sql`. Shipped as-is, the bundle can only
# ever start on this one machine. Rewrite those prefixes back to `./` (and
# flip the Windows separators) so the compose file resolves against whatever
# directory it is dropped into on the target - which is exactly the layout
# deploy.sh creates under $INSTALL_DIR.
function ConvertTo-RelativeComposePaths {
    param([string]$Yaml, [string]$Root)

    $rootBack = $Root.TrimEnd('\', '/')
    $rootFwd  = $rootBack -replace '\\', '/'
    $patterns = @([Regex]::Escape($rootBack), [Regex]::Escape($rootFwd)) | Sort-Object -Unique

    $rewritten = 0
    $lines = foreach ($line in ($Yaml -split "`r?`n")) {
        $l = $line
        foreach ($p in $patterns) { $l = $l -replace "$p[\\/]?", './' }
        if ($l -ne $line) {
            # These are pure path lines (`source: ...`, `- path: ...`), so a
            # blanket separator flip is safe and catches nested segments too.
            $l = $l -replace '\\', '/'
            $rewritten++
        }
        $l
    }

    Write-Host "  rewrote $rewritten absolute host path(s) to relative" -ForegroundColor Green
    return ($lines -join "`n")
}

# -- Discover repos -----------------------------------------------------------
# The platform root is repo #1; every child repo is any subfolder with its own
# docker-compose-linux.yml. Order matters: root first, so its .env.example
# values win on duplicate keys and its services anchor the merge.
Write-Step 'Discovering repos'

$RepoDirs = @($ProjectRoot)
$children = Get-ChildItem -Path $ProjectRoot -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'docker-compose-linux.yml') } |
    Sort-Object Name
if ($Repos) {
    $children = $children | Where-Object { $Repos -contains $_.Name }
}
$RepoDirs += $children.FullName

foreach ($r in $RepoDirs) {
    Write-Host "  $(Split-Path -Leaf $r)"
}
if ($RepoDirs.Count -lt 2) {
    Write-Host '  (no child repos found - bundling platform root only)' -ForegroundColor Yellow
}

# Each repo needs an .env.example for compose interpolation during `config`.
foreach ($r in $RepoDirs) {
    if (-not (Test-Path (Join-Path $r '.env.example'))) {
        Write-Error "Missing .env.example in $r - required to resolve its compose file."
    }
}

# -- Pre-checks ---------------------------------------------------------------
if (-not (Get-Command 'docker' -ErrorAction SilentlyContinue)) {
    Write-Error "'docker' is required but not found in PATH."
}

Write-Step 'Waiting for Docker engine to be ready'
$ready = $false
for ($i = 1; $i -le 10; $i++) {
    $null = Get-NativeOutput { docker info }
    if ($LASTEXITCODE -eq 0) { $ready = $true; Write-Host '  Docker is ready.' -ForegroundColor Green; break }
    Write-Host "  Attempt $i/10 - Docker not ready, retrying in 5s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
if (-not $ready) { Write-Error 'Docker engine not reachable. Start Rancher Desktop / Docker Desktop and retry.' }

# -- Step 1: Build every repo -------------------------------------------------
if ($SkipBuild) {
    Write-Step 'Skipping Docker build (repackage only)'
} else {
    foreach ($r in $RepoDirs) {
        $name = Split-Path -Leaf $r
        Write-Step "Building images: $name"
        Push-Location $r
        try {
            Invoke-Native { docker compose --env-file .env.example build } "docker compose build failed in $name."

            # `build` never fetches third-party images (postgres, exadel/compreface*).
            # --ignore-buildable pulls only the services that have no build context.
            # Both files are needed: docker-compose-linux.yml carries `image:` but
            # no `build:`, so on its own every service looks unbuildable and compose
            # tries to pull the msq-* images we just built locally. Merging the dev
            # file back in restores the build contexts, leaving only third-party
            # images (postgres, caddy, ...) to actually pull.
            Write-Host "  pulling third-party images for $name"
            Invoke-Native {
                docker compose -f docker-compose.yml -f docker-compose-linux.yml `
                    --env-file .env.example pull --ignore-buildable
            } "docker compose pull failed in $name."
        } finally {
            Pop-Location
        }
    }
}

# -- Step 2: Merge the linux compose files ------------------------------------
Write-Step 'Merging docker-compose-linux.yml files'

# Compose merges -f files left to right. Paths inside each file (volume mounts
# like ./db_scripts/...) resolve against the FIRST file's directory, which is
# the platform root - and that is where db_scripts lives, so the bundle's
# layout stays correct.
$composeArgs = @()
foreach ($r in $RepoDirs) {
    $composeArgs += '-f'
    $composeArgs += (Join-Path $r 'docker-compose-linux.yml')
}

Push-Location $ProjectRoot
try {
    # --no-interpolate keeps ${VAR} unresolved: the shipped compose file stays
    # configurable via the server's .env instead of freezing this host's values.
    $merged = Get-NativeOutput {
        docker compose @composeArgs --env-file (Join-Path $ProjectRoot '.env.example') config --no-interpolate
    }
    if ($LASTEXITCODE -ne 0) { Write-Error 'docker compose config (merge) failed.' }

    $ImagesList = Get-NativeOutput {
        docker compose @composeArgs --env-file (Join-Path $ProjectRoot '.env.example') config --images
    }
    if ($LASTEXITCODE -ne 0) { Write-Error 'docker compose config --images failed.' }
} finally {
    Pop-Location
}

$Images = @($ImagesList | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } | Sort-Object -Unique)
Write-Host "  $($Images.Count) images across $($RepoDirs.Count) repos"

# -- Step 3: Verify images exist ----------------------------------------------
Write-Step 'Verifying images exist locally'
$missing = @()
foreach ($img in $Images) {
    $id = Get-NativeOutput { docker images -q $img }
    if (-not $id) { $missing += $img }
}
if ($missing.Count -gt 0) {
    Write-Host '  Missing:' -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Error "$($missing.Count) image(s) not built. Third-party images (compreface, postgres) need `docker compose pull` first."
}
Write-Host "  All $($Images.Count) images found." -ForegroundColor Green

# -- Step 4: Prepare artifacts directory --------------------------------------
Write-Step 'Preparing artifacts directory'
Remove-Item -Recurse -Force $ArtifactsDir -Confirm:$false
New-Item -ItemType Directory -Force $ArtifactsDir | Out-Null
New-Item -ItemType Directory -Force $DbScriptsDst | Out-Null

$mergedYaml = ConvertTo-RelativeComposePaths -Yaml (($merged -join "`n") -replace "`r`n", "`n") -Root $ProjectRoot

# Fail loudly rather than shipping a bundle pinned to this build host.
if ($mergedYaml -match '(?m)^\s*(-\s*path|source):\s*[A-Za-z]:[\\/]') {
    Write-Error 'Merged compose file still contains absolute Windows host paths - the bundle would not start on the target machine.'
}

[System.IO.File]::WriteAllText($ComposeDst, $mergedYaml)
Write-Host "  docker-compose.yml (merged, $($RepoDirs.Count) repos)"

# -- Step 5: Merge .env.example files -----------------------------------------
Write-Step 'Merging .env.example files'

# Root file is copied verbatim to keep its comments; each child then contributes
# only keys the merge has not seen yet. First repo wins on duplicates - which is
# correct for the one real conflict (flat DATABASE_URL differs per product), and
# harmless because every service overrides DATABASE_URL via its compose
# `environment:` block from the per-product DB_*_SVC_USER/PASSWORD vars.
$seen = [System.Collections.Generic.HashSet[string]]::new()
$sb   = [System.Text.StringBuilder]::new()

$rootEnv = Read-Utf8Text (Join-Path $ProjectRoot '.env.example')
[void]$sb.AppendLine($rootEnv.TrimEnd())
foreach ($line in ($rootEnv -split "`r?`n")) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { [void]$seen.Add($Matches[1]) }
}

foreach ($r in $RepoDirs | Select-Object -Skip 1) {
    $name  = Split-Path -Leaf $r
    $added = @()
    foreach ($line in ((Read-Utf8Text (Join-Path $r '.env.example')) -split "`r?`n")) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
            if ($seen.Add($Matches[1])) { $added += $line }
        }
    }
    if ($added.Count -gt 0) {
        [void]$sb.AppendLine('')
        [void]$sb.AppendLine("# ---------------------------------------------------------------------------")
        [void]$sb.AppendLine("# $name  ($($added.Count) keys)")
        [void]$sb.AppendLine("# ---------------------------------------------------------------------------")
        $added | ForEach-Object { [void]$sb.AppendLine($_) }
    }
    Write-Host "  $name : +$($added.Count) keys"
}


# The roots keep NODE_ENV=development for local dev, but this artifact ships
# alongside images built with `pnpm deploy --prod` - dev-only deps (pino-pretty)
# are NOT in them, and compose's `env_file` overrides the image's own
# ENV NODE_ENV=production. Anything but `production` here crash-loops every
# Fastify service on the target box, so force it.
$merged = $sb.ToString() -replace "`r`n", "`n"
$merged = [regex]::Replace($merged, '(?m)^NODE_ENV=.*$', 'NODE_ENV=production')

# Same story: msq-lms keeps ALLOW_UNSIGNED_WEBHOOKS=true so local dev can POST
# Meta webhooks without a signature. meta-conversion-api refuses to boot with
# that enabled while NODE_ENV=production (services/meta-conversion-api/src/
# config/index.ts), so shipping the dev value crash-loops the service on the
# target box. Force it off; a deployment that genuinely needs unsigned webhooks
# has to opt in by hand on the server.
$merged = [regex]::Replace($merged, '(?m)^ALLOW_UNSIGNED_WEBHOOKS=.*$', 'ALLOW_UNSIGNED_WEBHOOKS=false')

# Service URLs, same reasoning again. The repo roots use localhost because in
# local dev the services run on the host. In the bundle every repo lands in the
# single `msq` compose project on msq_default, and these values are resolved
# from INSIDE a container -- where localhost is that container itself, so the
# gateway 502s on every proxied route. Rewrite to compose service names.
$ServiceHosts = [ordered]@{
    'API_GATEWAY_INTERNAL_URL'  = 'http://api-gateway:4000'
    'IDENTITY_SERVICE_URL'      = 'http://identity-service:4001'
    'COMMUNICATION_SERVICE_URL' = 'http://communication-service:4005'
    'ADMIN_SERVICE_URL'         = 'http://admin-service:4006'
    'LEADS_SERVICE_URL'         = 'http://leads-service:4002'
    'META_SERVICE_URL'          = 'http://meta-conversion-api:4003'
    'NOTIFICATIONS_SERVICE_URL' = 'http://notifications-service:4004'
    'HR_SERVICE_URL'            = 'http://hr-service:4007'
    'TASKS_SERVICE_URL'         = 'http://tasks-service:4008'
    'COMPREFACE_URL'            = 'http://compreface-api:8080'
}
foreach ($k in $ServiceHosts.Keys) {
    $merged = [regex]::Replace($merged, "(?m)^$k=.*$", "$k=$($ServiceHosts[$k])")
}

# DB_PRODUCT_SCOPED_LOGIN is PER-SERVICE, but the merge folds every repo's
# .env.example into one shared file that all services load via `env_file:`.
# msq-lms/msq-hrms/msq-todo each set it true (correct for their own logins:
# lms_svc/hr_svc/task_svc), so the merged value leaks onto identity-service/
# admin-service/api-gateway, which log in as the NOINHERIT lead_svc and must
# `SET LOCAL ROLE app_user` -- skipping it yields "permission denied for table
# organizations". The five services that genuinely need true already get it
# from their own compose `environment:` block, which overrides env_file.
$merged = [regex]::Replace($merged, '(?m)^DB_PRODUCT_SCOPED_LOGIN=.*$', 'DB_PRODUCT_SCOPED_LOGIN=false')

[System.IO.File]::WriteAllText($EnvDst, $merged)
Write-Host "  .env.example ($($seen.Count) keys total, NODE_ENV=production, ALLOW_UNSIGNED_WEBHOOKS=false)"

# -- Step 6: Export images to ONE .tar ----------------------------------------
Write-Step "Exporting $($Images.Count) images to msq-images.tar"
Invoke-Native { docker save -o $TarFile $Images } 'docker save failed.'
Write-Host ("  msq-images.tar: {0:N2} GB" -f ((Get-Item $TarFile).Length / 1GB)) -ForegroundColor Green

# -- Step 7: Copy db_scripts --------------------------------------------------
Write-Step 'Copying db_scripts'
$SrcDbScripts = Join-Path $ProjectRoot 'db_scripts'
foreach ($f in $SchemaScripts) {
    $src = Join-Path $SrcDbScripts $f
    if (-not (Test-Path $src)) { Write-Error "Required schema script missing: $f" }
    Copy-Item $src (Join-Path $DbScriptsDst $f)
}
Get-ChildItem -Path $SrcDbScripts -Filter '*.sql' -File |
    Where-Object { $SchemaScripts -notcontains $_.Name } |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $DbScriptsDst $_.Name) }

# _migrations/ is NOT optional: 17 and 19 are part of every install (see
# db_scripts/_migrations/README.md and the $RemainingCoreScripts list in
# db_scripts/db_deploy.ps1). Without 17 the tenant-scoped RLS in 06 hides every
# LMS lead catalog row, so Status/Outcome/Source/Follow-up render blank for
# every non-super_admin user. Copying only top-level *.sql silently dropped them.
$SrcMigrations = Join-Path $SrcDbScripts '_migrations'
$DstMigrations = Join-Path $DbScriptsDst '_migrations'
foreach ($f in $MigrationScripts) {
    if (-not (Test-Path (Join-Path $SrcMigrations $f))) {
        Write-Error "Required migration script missing: _migrations/$f"
    }
}
New-Item -ItemType Directory -Force $DstMigrations | Out-Null
Get-ChildItem -Path $SrcMigrations -Filter '*.sql' -File |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $DstMigrations $_.Name) }

Write-Host "  db_scripts/ ($((Get-ChildItem $DbScriptsDst -File).Count) .sql files, $((Get-ChildItem $DstMigrations -File).Count) in _migrations/)"

# -- Step 8: Linux deploy helper ----------------------------------------------
Write-Step 'Generating deploy.sh'
$deployScript = @'
#!/usr/bin/env bash
set -euo pipefail

# -- MSQ Deploy / Redeploy Script ---------------------------------------------
# Deploys the full platform (core + lms + hrms + todo) as one compose project.
# Usage:
#   sudo ./deploy.sh              # first-time install (schema + lookups + demo seed)
#   sudo ./deploy.sh --no-seed    # first-time install, no demo tenants/orgs/users
#   sudo ./deploy.sh --redeploy   # update images and restart, leave the DB alone
#
# The very first run copies .env.example to .env and STOPS so you can edit it -
# run the script again afterwards to actually bring the stack up.

INSTALL_DIR="${INSTALL_DIR:-/opt/msq}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REDEPLOY=false
NO_SEED=false

for arg in "$@"; do
    case "$arg" in
        --redeploy) REDEPLOY=true ;;
        --no-seed)  NO_SEED=true ;;
        *) echo "!! Unknown option: $arg (expected --redeploy and/or --no-seed)"; exit 1 ;;
    esac
done

echo "==> MSQ deployment ($(if $REDEPLOY; then echo 'REDEPLOY'; else echo 'FRESH INSTALL'; fi))"

echo "==> Creating directory structure at $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/data/postgres" "$INSTALL_DIR/backups" "$INSTALL_DIR/db_scripts"

echo "==> Copying deployment files"
cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
# -r and the trailing /. so db_scripts/_migrations/ comes along: 17 and 19 are
# part of every install, not optional extras.
cp -r "$SCRIPT_DIR/db_scripts/." "$INSTALL_DIR/db_scripts/"
install -m 0755 "$SCRIPT_DIR/bootstrap-db.sh" "$INSTALL_DIR/bootstrap-db.sh"

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env"
    echo ""
    echo "============================================="
    echo "  .env created from the example - EDIT IT, then re-run this script."
    echo ""
    echo "    nano $INSTALL_DIR/.env"
    echo ""
    echo "  At minimum you MUST change:"
    echo "    DB_DATA_PATH      - the example is a Windows path (C:/...), invalid here."
    echo "                        Use $INSTALL_DIR/data/postgres"
    echo "    POSTGRES_PASSWORD, DB_*_SVC_PASSWORD, JWT/session secrets"
    echo "    NEXT_PUBLIC_* URLs - must be this host's address, not localhost,"
    echo "                        if anything connects from another machine."
    echo ""
    echo "  Stopping here on purpose: starting the stack now would initialise"
    echo "  the database with the example credentials, and postgres only applies"
    echo "  the bootstrap schema on the FIRST boot of an empty data directory."
    echo "============================================="
    exit 0
else
    echo "    .env already exists - skipping (won't overwrite your config)"
fi

IMAGE_FILE="$SCRIPT_DIR/msq-images.tar"
if [[ ! -f "$IMAGE_FILE" ]]; then
    echo "!! No image archive found at $IMAGE_FILE"
    exit 1
fi

echo "==> Loading Docker images (this may take several minutes)"
docker load -i "$IMAGE_FILE"

if $REDEPLOY; then
    echo "==> Stopping existing stack"
    cd "$INSTALL_DIR"
    docker compose down || true
fi

echo "==> Starting MSQ stack"
cd "$INSTALL_DIR"
docker compose up -d

echo "==> Waiting for containers to start..."
sleep 5
docker compose ps

# The postgres container applies schema 01-06 itself, from the files compose
# mounts into /docker-entrypoint-initdb.d -- but ONLY on the first boot of an
# empty data directory. Everything after that (lookup data, demo seed, and the
# mandatory tenant-scoping migrations 17/19) has to be driven in explicitly.
# Skipped on --redeploy: the DB already exists and the images are all that moved.
if $REDEPLOY; then
    echo ""
    echo "==> Skipping DB bootstrap (--redeploy). Run ./bootstrap-db.sh by hand if schema changed."
else
    echo ""
    if $NO_SEED; then
        INSTALL_DIR="$INSTALL_DIR" bash "$INSTALL_DIR/bootstrap-db.sh" --no-seed
    else
        INSTALL_DIR="$INSTALL_DIR" bash "$INSTALL_DIR/bootstrap-db.sh"
    fi
fi

echo ""
echo "==> Cleaning up dangling images"
docker image prune -f

echo ""
echo "============================================="
echo "  MSQ deployment complete!"
echo "  Auth web:     http://localhost:3000"
echo "  LMS web:      http://localhost:3001"
echo "  HR web:       http://localhost:3002"
echo "  Todo web:     http://localhost:3003"
echo "  Lookup admin: http://localhost:3005"
echo "  API gateway:  http://localhost:4000"
echo ""
echo "  Config:  $INSTALL_DIR/.env"
echo "  Logs:    docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "============================================="
'@

[System.IO.File]::WriteAllText((Join-Path $ArtifactsDir 'deploy.sh'), ($deployScript -replace "`r`n", "`n"))
Write-Host '  deploy.sh'

# -- Step 9: Post-schema DB bootstrap helper ----------------------------------
Write-Step 'Generating bootstrap-db.sh'
$bootstrapScript = @'
#!/usr/bin/env bash
set -euo pipefail

# -- MSQ post-schema database bootstrap ---------------------------------------
# The postgres container applies schema 01-06 itself, from the files
# docker-compose.yml mounts into /docker-entrypoint-initdb.d -- but only on the
# FIRST boot of an empty data directory. Everything after that is not mounted
# and must be driven from here.
#
# Order mirrors db_scripts/db_deploy.ps1 exactly. 17 and 19 run LAST, after the
# demo seed, because they need entity.tenants populated: 07 seeds the LMS lead
# catalogs and the ladder roles as GLOBAL rows (tenant_id IS NULL) and these two
# fan each one into an identical copy per tenant. Skip them and the
# tenant-scoped RLS in 06_rls.sql hides every catalog row (`NULL = <tenant>` is
# never true), so Status / Outcome / Source / Follow-up render blank for every
# user except super_admin.
#
# Every script here is idempotent - re-running this is safe.
#
# Usage:
#   ./bootstrap-db.sh             # lookup data + demo seed + tenant scoping
#   ./bootstrap-db.sh --no-seed   # lookup data + tenant scoping only

INSTALL_DIR="${INSTALL_DIR:-/opt/msq}"
SEED=true

case "${1:-}" in
    "")        ;;
    --no-seed) SEED=false ;;
    *) echo "!! Unknown option: $1 (expected --no-seed)"; exit 1 ;;
esac

cd "$INSTALL_DIR"

if [[ ! -f .env ]]; then
    echo "!! $INSTALL_DIR/.env not found - run deploy.sh first"
    exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${DB_CONTAINER_NAME:?not set in .env}"
: "${POSTGRES_USER:?not set in .env}"
: "${POSTGRES_PASSWORD:?not set in .env}"
: "${DB_NAME:?not set in .env}"

CORE=(
    07_seed_lookup_data.sql
)
DEMO=(
    08_seed_tenants_orgs_users.sql
    09_seed_leads_bulk.sql
    10_seed_interactions_followups.sql
    11_cleanup_seed_helpers.sql
    12a_cleanup_demo_data_pre.sql
    12b_cleanup_demo_data.sql
    12c_cleanup_demo_data_post.sql
)
REST=(
    13_backfill_per_product_roles.sql
    _migrations/17_tenant_scope_lms_catalogs.sql
    _migrations/19_tenant_scope_ladder_roles.sql
)

if $SEED; then
    SCRIPTS=("${CORE[@]}" "${DEMO[@]}" "${REST[@]}")
else
    SCRIPTS=("${CORE[@]}" "${REST[@]}")
fi

echo "==> Verifying SQL scripts"
for f in "${SCRIPTS[@]}"; do
    if [[ ! -f "db_scripts/$f" ]]; then
        echo "!! Missing script: $INSTALL_DIR/db_scripts/$f"
        exit 1
    fi
done
echo "    ${#SCRIPTS[@]} script(s) found"

echo "==> Waiting for postgres to accept connections"
for i in $(seq 1 60); do
    if docker exec "$DB_CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d "$DB_NAME" >/dev/null 2>&1; then
        echo "    ready"
        break
    fi
    if [[ $i -eq 60 ]]; then
        echo "!! postgres not ready after 120s - check: docker compose logs postgres"
        exit 1
    fi
    sleep 2
done

# Connect as the superuser, not root_service: 17 issues ALTER TABLE and must
# also see the global rows it is replacing. root_service is BYPASSRLS but does
# not own these tables, so it cannot do the ALTERs.
# ON_ERROR_STOP=1 makes psql exit non-zero on the first error, printing the
# exact line, so a failure here stops the run instead of half-applying.
echo "==> Running post-schema scripts against $DB_NAME"
for f in "${SCRIPTS[@]}"; do
    echo "    -- $f"
    docker exec -i -e "PGPASSWORD=$POSTGRES_PASSWORD" "$DB_CONTAINER_NAME" \
        psql -U "$POSTGRES_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "db_scripts/$f"
done

echo ""
echo "============================================="
echo "  Database bootstrap complete: $DB_NAME"
if $SEED; then
    echo "  Demo tenants / orgs / users seeded."
else
    echo "  No demo data (--no-seed)."
fi
echo "============================================="
'@

[System.IO.File]::WriteAllText((Join-Path $ArtifactsDir 'bootstrap-db.sh'), ($bootstrapScript -replace "`r`n", "`n"))
Write-Host '  bootstrap-db.sh'

# -- Summary ------------------------------------------------------------------
Write-Step 'Done! Artifacts ready:'
Get-ChildItem -Path $ArtifactsDir -Recurse | ForEach-Object {
    $rel  = $_.FullName.Substring($ArtifactsDir.Length + 1)
    $size = if ($_.PSIsContainer) { '<DIR>' } else { '{0:N1} MB' -f ($_.Length / 1MB) }
    Write-Host "  $rel  ($size)"
}

Write-Host @"

Next steps:
  1. Copy the artifacts folder to USB or scp to the Linux machine
  2. On Linux: edit .env (set passwords, paths, IPs)
  3. Run:  sudo bash deploy.sh             # first time
           sudo bash deploy.sh --redeploy  # update
"@ -ForegroundColor Yellow
