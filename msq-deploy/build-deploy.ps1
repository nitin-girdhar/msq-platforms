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

# -- Helpers ------------------------------------------------------------------
function Write-Step([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

function Invoke-Native([scriptblock]$block, [string]$failMessage) {
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $block } finally { $ErrorActionPreference = $savedEAP }
    if ($LASTEXITCODE -ne 0) { Write-Error $failMessage }
}

function Get-NativeOutput([scriptblock]$block) {
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = & $block 2>$null } finally { $ErrorActionPreference = $savedEAP }
    return $out
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

[System.IO.File]::WriteAllText($ComposeDst, (($merged -join "`n") -replace "`r`n", "`n"))
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

$rootEnv = Get-Content (Join-Path $ProjectRoot '.env.example') -Raw
[void]$sb.AppendLine($rootEnv.TrimEnd())
foreach ($line in ($rootEnv -split "`r?`n")) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { [void]$seen.Add($Matches[1]) }
}

foreach ($r in $RepoDirs | Select-Object -Skip 1) {
    $name  = Split-Path -Leaf $r
    $added = @()
    foreach ($line in (Get-Content (Join-Path $r '.env.example'))) {
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

[System.IO.File]::WriteAllText($EnvDst, ($sb.ToString() -replace "`r`n", "`n"))
Write-Host "  .env.example ($($seen.Count) keys total)"

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
Write-Host "  db_scripts/ ($((Get-ChildItem $DbScriptsDst -File).Count) .sql files)"

# -- Step 8: Linux deploy helper ----------------------------------------------
Write-Step 'Generating deploy.sh'
$deployScript = @'
#!/usr/bin/env bash
set -euo pipefail

# -- MSQ Deploy / Redeploy Script ---------------------------------------------
# Deploys the full platform (core + lms + hrms + todo) as one compose project.
# Usage:
#   sudo ./deploy.sh              # first-time install
#   sudo ./deploy.sh --redeploy   # update images and restart

INSTALL_DIR="/opt/msq"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REDEPLOY=false

if [[ "${1:-}" == "--redeploy" ]]; then
    REDEPLOY=true
fi

echo "==> MSQ deployment ($(if $REDEPLOY; then echo 'REDEPLOY'; else echo 'FRESH INSTALL'; fi))"

echo "==> Creating directory structure at $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/data/postgres" "$INSTALL_DIR/backups" "$INSTALL_DIR/db_scripts"

echo "==> Copying deployment files"
cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
cp "$SCRIPT_DIR"/db_scripts/*.sql "$INSTALL_DIR/db_scripts/"

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env"
    echo "    .env copied from example - EDIT IT before starting the stack!"
    echo "    nano $INSTALL_DIR/.env"
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
