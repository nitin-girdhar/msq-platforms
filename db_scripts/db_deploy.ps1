<#
.SYNOPSIS
    Deploy the entire MSquare platform database (fresh install) to a PostgreSQL
    Docker container.

.DESCRIPTION
    Drops and recreates the target database, then runs the single, platform-wide
    fresh-install SQL sequence in order. Stops immediately on any SQL error and
    prints the full error output.

    This is now the ONE AND ONLY deploy script for the platform. The four product
    repos (msq-core / msq-hrms / msq-lms / msq-todo) no longer carry their own
    db_scripts folders — all schema for every product (shared core, lms/marketing,
    hr, task) is consolidated into this directory's ordered 01-06 DDL set and
    deploys to one shared database.

    Demo/seed data (tenants, orgs, users, sample leads) is included by default via
    -IncludeDemoSeed:$true; pass -IncludeDemoSeed:$false for a clean production-shape
    bootstrap with no demo rows.

    This script always DROPs and recreates the database — it is a fresh-install tool,
    not an upgrade tool. To bring an already-deployed database (created before the
    P1.0 crm-naming cleanup, i.e. still has schema `crm` / role `crm_service`) up to
    the current shape without losing data, run the two migrations in _migrations/
    (15 then 16) directly against that live database instead of this script —
    see _migrations/README.md.

.EXAMPLE
    .\db_deploy.ps1
    .\db_deploy.ps1 -ContainerName crm-postgres -Database crm_v2
    .\db_deploy.ps1 -IncludeDemoSeed:$false
#>
param(
    [string]$Database        = "crm_v2",
    [string]$DbHost          = "localhost",
    [string]$Port            = "5433",
    [string]$User            = "sa",
    [string]$Password        = "Passw0rd",
    [string]$ContainerName   = "crm-postgres",
    [string]$SeedPassword    = "Admin@12345",
    [bool]  $IncludeDemoSeed = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptsDir = $PSScriptRoot

# Consolidated platform-wide DDL (01-06) + seed/data scripts (07+).
# _migrations/ (15/16) is deliberately excluded — guarded no-ops on a fresh
# install (01/03 already create schema `lms` / role `root_service` / the 'lms'
# entitlement key directly); they only matter when upgrading a pre-P1.0
# deployment in place. See _migrations/README.md.
# The old 24_move-api-clients-to-iam.sql was dropped outright: it only relocated
# ext.api_clients -> iam.api_clients for pre-existing deployments; 02_schema.sql
# now creates iam.api_clients directly, so it was already a guaranteed no-op
# on every fresh install.
$CoreScripts = @(
    "01_extensions_and_roles.sql",
    "02_schema.sql",
    "03_product_schema.sql",
    "04_roles_and_grants.sql",
    "05_catalogs.sql",
    "06_rls.sql",
    "07_seed_lookup_data.sql"
)

$DemoSeedScripts = @(
    "08_seed_tenants_orgs_users.sql",
    "09_seed_leads_bulk.sql",
    "10_seed_interactions_followups.sql",
    "11_cleanup_seed_helpers.sql",
    "12a_cleanup_demo_data_pre.sql",
    "12b_cleanup_demo_data.sql",
    "12c_cleanup_demo_data_post.sql"
)

$RemainingCoreScripts = @(
    "13_backfill_per_product_roles.sql"
)

$SqlScripts = if ($IncludeDemoSeed) {
    $CoreScripts + $DemoSeedScripts + $RemainingCoreScripts
} else {
    $CoreScripts + $RemainingCoreScripts
}

# ── Helpers ─────────────────────────────────────────────────────────────────

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host ">> $msg" -ForegroundColor Cyan
}

# Run a short inline SQL command against the container (e.g. DROP/CREATE DATABASE).
# Errors print naturally to the console; non-zero exit stops the script.
function Invoke-Sql {
    param([string]$Db, [string]$Sql, [string]$Label)
    Write-Host "   $Label ..." -NoNewline
    docker exec -e "PGPASSWORD=$Password" $ContainerName `
        psql -U $User -d $Db -c $Sql
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "   [OK]" -ForegroundColor Green
}

# Copy a SQL file into the container and run it with psql -f.
# ON_ERROR_STOP=1 makes psql exit non-zero on the first SQL error and print
# the exact line and error message before stopping.
function Invoke-SqlFile {
    param([string]$Db, [string]$FilePath, [string]$Label)

    Write-Host ""
    Write-Host "   -- $Label" -ForegroundColor White

    # Random name to avoid collisions if two runs overlap
    $rand          = -join ((65..90) | Get-Random -Count 10 | ForEach-Object { [char]$_ })
    $containerPath = "/tmp/crm_deploy_$rand.sql"
    $tmpHost       = [System.IO.Path]::GetTempFileName()

    try {
        # Re-encode to UTF-8 without BOM (psql requires clean UTF-8)
        $content = [System.IO.File]::ReadAllText($FilePath, [System.Text.Encoding]::UTF8)
        [System.IO.File]::WriteAllText($tmpHost, $content, (New-Object System.Text.UTF8Encoding $false))

        docker cp $tmpHost "${ContainerName}:${containerPath}" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   ERROR: docker cp to container failed" -ForegroundColor Red
            exit 1
        }

        # psql prints the error (file:line: ERROR: ...) then exits non-zero
        docker exec -e "PGPASSWORD=$Password" $ContainerName `
            psql -U $User -d $Db -v ON_ERROR_STOP=1 -f $containerPath

        $psqlExit = $LASTEXITCODE

        # Clean up temp file in container regardless of outcome
        docker exec $ContainerName rm -f $containerPath | Out-Null

        if ($psqlExit -ne 0) {
            Write-Host ""
            Write-Host "   FAILED: $Label exited with code $psqlExit" -ForegroundColor Red
            Write-Host "   (error details are printed above by psql)" -ForegroundColor Yellow
            exit $psqlExit
        }
    } finally {
        Remove-Item $tmpHost -Force -ErrorAction SilentlyContinue
    }

    Write-Host "   [OK] $Label" -ForegroundColor Green
}

# ── 1. Verify container is running ───────────────────────────────────────────
Write-Step "Checking container: $ContainerName"

$containerStatus = docker inspect --format "{{.State.Status}}" $ContainerName 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "   ERROR: Container '$ContainerName' not found. Is Docker running?" -ForegroundColor Red
    exit 1
}
if ($containerStatus.Trim() -ne "running") {
    Write-Host "   ERROR: Container '$ContainerName' is not running (status: $containerStatus)" -ForegroundColor Red
    exit 1
}
Write-Host "   Container is running [OK]" -ForegroundColor Green

# ── 2. Verify all SQL scripts are present ────────────────────────────────────
Write-Step "Verifying SQL scripts"

foreach ($f in $SqlScripts) {
    $p = Join-Path $ScriptsDir $f
    if (-not (Test-Path $p)) {
        Write-Host "   ERROR: Missing script: $p" -ForegroundColor Red
        exit 1
    }
    Write-Host "   Found: $f" -ForegroundColor Green
}

# ── 3. Drop & recreate database ──────────────────────────────────────────────
Write-Step "Recreating database: $Database"

Invoke-Sql -Db "postgres" `
    -Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$Database' AND pid <> pg_backend_pid();" `
    -Label "Terminate active connections"

Invoke-Sql -Db "postgres" `
    -Sql "DROP DATABASE IF EXISTS $Database;" `
    -Label "Drop database"

Invoke-Sql -Db "postgres" `
    -Sql "CREATE DATABASE $Database;" `
    -Label "Create database"

# ── 4. Run the fresh-install sequence in order ───────────────────────────────
Write-Step "Running SQL scripts against $Database"

foreach ($fileName in $SqlScripts) {
    $filePath = Join-Path $ScriptsDir $fileName
    Invoke-SqlFile -Db $Database -FilePath $filePath -Label $fileName
}

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Database  : $Database" -ForegroundColor Green
Write-Host "  Container : $ContainerName" -ForegroundColor Green
Write-Host "  Seed password: $SeedPassword" -ForegroundColor Green
Write-Host "  Connect   : psql -h $DbHost -p $Port -U $User -d $Database" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
