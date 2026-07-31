<#
.SYNOPSIS
    Deploy the MSquare platform database (fresh install) to a PostgreSQL
    Docker container.

.DESCRIPTION
    Drops and recreates the target database, then runs the schema scripts
    (00-10), then reference_data/. Stops on the first SQL error and prints it.

    This is a FRESH-INSTALL tool, not an upgrade tool. The scripts describe the
    target schema declaratively -- every column and constraint lives in its
    CREATE statement, there is no ALTER-after-the-fact section and no
    _migrations/ folder. To change the schema, edit the CREATE and redeploy.

    LAYOUT
      00_extensions_schemas_roles  extensions, schemas, every DB role
      01_functions_shared          functions used in column DEFAULTs
      02_tables_core               geo/entity/iam/lms/marketing/audit/ext/comms
      03_tables_product            hr/task, per-product RBAC, catalog engine
      04_functions_triggers        business logic + every trigger
      05_views                     all views
      06_indexes                   all indexes
      07_grants                    all privileges
      08_rls                       row-level security
      09_schema_version            version history
      10_tenant_provisioning       entity.provision_tenant() and friends
      reference_data/              required by every deployment
      dummy_data/                  demo data for local development only

    DEFAULT BEHAVIOUR
    A plain run gives you a production-shape database: schema + reference data,
    no tenants. Pass -IncludeDummyData to add the demo tenants, users and leads.

    The cleanup script (dummy_data/99_cleanup_dummy_data.sql) is deliberately
    NOT in any list here. It used to be: the old script ran the demo seed and
    then the teardown in the same sequence, so a default deploy created two
    tenants and 5000 leads and immediately deleted them, and the tenant-scoping
    scripts that ran afterwards found no tenants and silently did nothing.
    Run it by hand when you want the demo data gone.

    Connection defaults come from the repo-root .env (falling back to
    .env.example). Pass any -param explicitly to override.

.EXAMPLE
    .\db_deploy.ps1                        # production shape: schema + reference data
    .\db_deploy.ps1 -IncludeDummyData      # + demo tenants, users, leads
    .\db_deploy.ps1 -Database platforms_test
#>
param(
    [string]$Database,
    [string]$DbHost           = "localhost",
    [string]$Port,
    [string]$User,
    [string]$Password,
    [string]$ContainerName,
    [string]$SeedPassword     = "Admin@12345",
    [switch]$IncludeDummyData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptsDir = $PSScriptRoot

# ── Connection defaults come from the repo's .env ────────────────────────────
$RepoRoot = Split-Path -Parent $ScriptsDir
$EnvFile  = Join-Path $RepoRoot '.env'
if (-not (Test-Path $EnvFile)) { $EnvFile = Join-Path $RepoRoot '.env.example' }

# ReadAllText, not Get-Content: PS 5.1's Get-Content decodes a BOM-less file as
# CP1252, which mangles the box-drawing characters in .env's comment banners.
$EnvMap = @{}
if (Test-Path $EnvFile) {
    foreach ($line in ([System.IO.File]::ReadAllText($EnvFile) -split "`r?`n")) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            $EnvMap[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
        }
    }
}

$Defaults = @{
    Database      = @{ Key = 'DB_NAME';            Fallback = 'platforms'     }
    Port          = @{ Key = 'DB_PORT';            Fallback = '5432'          }
    User          = @{ Key = 'POSTGRES_USER';      Fallback = 'postgres'      }
    Password      = @{ Key = 'POSTGRES_PASSWORD';  Fallback = 'Passw0rd'      }
    ContainerName = @{ Key = 'DB_CONTAINER_NAME';  Fallback = 'msq-db-server' }
}
foreach ($name in $Defaults.Keys) {
    if ($PSBoundParameters.ContainsKey($name)) { continue }
    $spec  = $Defaults[$name]
    $value = if ($EnvMap.ContainsKey($spec.Key) -and $EnvMap[$spec.Key]) { $EnvMap[$spec.Key] } else { $spec.Fallback }
    Set-Variable -Name $name -Value $value -Scope Script
}

Write-Host "Config source: $(if (Test-Path $EnvFile) { $EnvFile } else { 'built-in defaults' })" -ForegroundColor DarkGray
Write-Host "  container=$ContainerName  db=$Database  user=$User  port=$Port" -ForegroundColor DarkGray

# ── Script sequence ──────────────────────────────────────────────────────────
# Both folders are globbed and sorted, so adding a file needs no edit here.
$SchemaScripts = @(
    "00_extensions_schemas_roles.sql",
    "01_functions_shared.sql",
    "02_tables_core.sql",
    "03_tables_product.sql",
    "04_functions_triggers.sql",
    "05_views.sql",
    "06_indexes.sql",
    "07_grants.sql",
    "08_rls.sql",
    "09_schema_version.sql",
    "10_tenant_provisioning.sql"
)

function Get-FolderScripts([string]$Folder) {
    $dir = Join-Path $ScriptsDir $Folder
    if (-not (Test-Path $dir)) { return @() }
    # 99_cleanup is a tool, never a deploy step.
    Get-ChildItem -Path $dir -Filter '*.sql' |
        Where-Object { $_.Name -notlike '99_*' } |
        Sort-Object Name |
        ForEach-Object { "$Folder/$($_.Name)" }
}

$SqlScripts = @($SchemaScripts) + @(Get-FolderScripts 'reference_data')
if ($IncludeDummyData) { $SqlScripts += @(Get-FolderScripts 'dummy_data') }

# ── Helpers ─────────────────────────────────────────────────────────────────

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host ">> $msg" -ForegroundColor Cyan
}

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

    $rand          = -join ((65..90) | Get-Random -Count 10 | ForEach-Object { [char]$_ })
    $containerPath = "/tmp/msq_deploy_$rand.sql"
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

        docker exec -e "PGPASSWORD=$Password" $ContainerName `
            psql -U $User -d $Db -v ON_ERROR_STOP=1 -f $containerPath

        $psqlExit = $LASTEXITCODE
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

Invoke-Sql -Db "postgres" -Sql "DROP DATABASE IF EXISTS $Database;" -Label "Drop database"
Invoke-Sql -Db "postgres" -Sql "CREATE DATABASE $Database;"         -Label "Create database"

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
Write-Host "  Contents  : schema + reference data$(if ($IncludeDummyData) { ' + dummy data' })" -ForegroundColor Green
if ($IncludeDummyData) {
    Write-Host "  Seed password: $SeedPassword" -ForegroundColor Green
    Write-Host "  Remove demo data: psql -f dummy_data/99_cleanup_dummy_data.sql" -ForegroundColor DarkGray
} else {
    Write-Host "  Add a tenant : SELECT entity.provision_tenant('<tenant-uuid>');" -ForegroundColor DarkGray
}
Write-Host "  Connect   : psql -h $DbHost -p $Port -U $User -d $Database" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
