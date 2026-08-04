# ===================================================================
# apply_schema.ps1 — push the declarative schema onto a database that
# has data, without dropping it.
#
# The counterpart to db_deploy.ps1. That one DROPs and recreates, which is
# right for local development and fatal for UAT and production. This one
# re-asserts the object definitions in place.
#
# It re-runs only the db_scripts files that are safe to re-run, because
# every statement in them is idempotent by construction:
#
#   04_functions_triggers.sql   CREATE OR REPLACE FUNCTION
#   05_views.sql                CREATE OR REPLACE VIEW
#   06_indexes.sql              CREATE INDEX IF NOT EXISTS
#   07_grants.sql               GRANT / REVOKE
#   08_rls.sql                  DROP POLICY IF EXISTS + CREATE POLICY
#   10_tenant_provisioning.sql  CREATE OR REPLACE FUNCTION
#
# Deliberately NOT re-run:
#   00-01  extensions, schemas, roles — cluster-level, rarely changed, and
#          00 creates login roles whose passwords come from .env
#   02-03  CREATE TABLE IF NOT EXISTS, so they are silent no-ops on a
#          populated database. A new column or a changed type will NOT be
#          picked up here — see "Changing a table" below.
#   09     version history, seeded once at install
#   reference_data/, dummy_data/  data, not schema
#
# CHANGING A TABLE
# ----------------
# Adding a column, changing a type or adding a constraint needs a hand-written
# ALTER against the live database, because 02/03 cannot express a transform.
# Do it, then run this script so the views, indexes, grants and policies that
# reference the new shape are rebuilt. Keep the CREATE TABLE in 02/03 in step
# so a fresh install produces the same result, and record the change in
# 09_schema_version.sql.
#
#   .\apply_schema.ps1                       local container
#   .\apply_schema.ps1 -DryRun               list what would run, change nothing
#   .\apply_schema.ps1 -DbHost 10.0.0.5      remote UAT/production
#   .\apply_schema.ps1 -Backup               pg_dump to db_backups/ first
#   .\apply_schema.ps1 -File 05_views.sql    re-assert one file only
# ===================================================================

[CmdletBinding()]
param(
    # Re-assert a single file instead of all six. Must be one of the names
    # listed in $ReassertFiles below.
    [string] $File,
    [switch] $DryRun,
    # Opt-in pg_dump before touching anything. Off by default: this script
    # creates and replaces objects, it does not move rows. Worth setting for
    # a production run all the same.
    [switch] $Backup,
    [string] $Database,
    [string] $Port,
    [string] $User,
    [string] $Password,
    [string] $ContainerName,
    # Remote target (UAT/production). When empty — the default — psql and
    # pg_dump run inside $ContainerName against that container's OWN postgres,
    # which is the local-development behaviour.
    #
    # When set, the container is used only as a client: it still runs the
    # psql/pg_dump binaries (matching the server version, and saving a local
    # install) but connects over TCP to -h $DbHost. The SQL files are copied
    # into the container either way, so nothing else here has to care which
    # target it is talking to.
    [string] $DbHost
)

$ErrorActionPreference = 'Stop'
$DbRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $DbRoot

$ReassertFiles = @(
    '04_functions_triggers.sql',
    '05_views.sql',
    '06_indexes.sql',
    '07_grants.sql',
    '08_rls.sql',
    '10_tenant_provisioning.sql'
)

# ── Config: same .env and same defaults as db_deploy.ps1 ─────────────────────
$EnvFile = Join-Path $RepoRoot '.env'
$EnvMap  = @{}
if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*#') { continue }
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

# Connection flags shared by every psql/pg_dump call below. Built once so a
# local run and a remote run differ in exactly one place.
$ConnArgs = @('-U', $User)
if ($DbHost) { $ConnArgs += @('-h', $DbHost, '-p', $Port) }

if ($DbHost) {
    Write-Host "Target: REMOTE $DbHost`:$Port db=$Database user=$User (client: $ContainerName)" -ForegroundColor Yellow
} else {
    Write-Host "Target: container=$ContainerName db=$Database user=$User" -ForegroundColor DarkGray
}

# ── Helpers ─────────────────────────────────────────────────────────────────
# psql writes NOTICEs to stderr, and these scripts RAISE NOTICE deliberately.
# Under $ErrorActionPreference='Stop', PowerShell turns any native-command
# stderr line into a terminating NativeCommandError — which would abort a run
# that is in fact succeeding. Exit code is the only trustworthy signal from a
# native exe, so these helpers drop back to 'Continue' for the call and check
# $LASTEXITCODE themselves.
function Invoke-Scalar([string] $Sql) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        (docker exec -e PGPASSWORD=$Password $ContainerName psql @ConnArgs -d $Database -tAc $Sql) -join "`n"
    } finally { $ErrorActionPreference = $prev }
}

function Invoke-File([string] $HostPath, [string] $Label) {
    $name = Split-Path -Leaf $HostPath
    Write-Host "  -> $Label" -ForegroundColor Cyan
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        docker cp $HostPath "${ContainerName}:/tmp/$name" | Out-Null
        docker exec -e PGPASSWORD=$Password $ContainerName `
            psql @ConnArgs -d $Database -v ON_ERROR_STOP=1 -f "/tmp/$name"
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) {
        throw "FAILED: $name (exit $code). That file ran in a transaction, so the database is unchanged by it."
    }
}

# ── Reachability ────────────────────────────────────────────────────────────
$probe = Invoke-Scalar "SELECT 1"
if ($probe -ne '1') { throw "Cannot reach $Database via container $ContainerName." }

# ── What will run ───────────────────────────────────────────────────────────
$targets = if ($File) {
    if ($ReassertFiles -notcontains $File) {
        throw "-File must be one of: $($ReassertFiles -join ', ')"
    }
    @($File)
} else {
    $ReassertFiles
}

foreach ($f in $targets) {
    $path = Join-Path $DbRoot $f
    if (-not (Test-Path $path)) { throw "Missing $f in $DbRoot" }
}

Write-Host ""
Write-Host "Will re-assert:" -ForegroundColor Yellow
$targets | ForEach-Object { Write-Host "  $_" }

if ($DryRun) {
    Write-Host ""
    Write-Host "DryRun - nothing was changed." -ForegroundColor Yellow
    return
}

# ── Optional backup ─────────────────────────────────────────────────────────
$dumpName = $null
if ($Backup) {
    $backupDir = Join-Path $RepoRoot 'db_backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $stamp    = Get-Date -Format 'yyyyMMdd_HHmmss'
    $dumpName = "${Database}_pre_apply_$stamp.dump"

    Write-Host ""
    Write-Host "Backing up to db_backups/$dumpName ..." -ForegroundColor Cyan
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        docker exec -e PGPASSWORD=$Password $ContainerName pg_dump @ConnArgs -d $Database -Fc -f "/tmp/$dumpName"
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    if ($code -ne 0) { throw "pg_dump failed - refusing to continue without the backup you asked for." }

    docker cp "${ContainerName}:/tmp/$dumpName" (Join-Path $backupDir $dumpName) | Out-Null
    $size = (Get-Item (Join-Path $backupDir $dumpName)).Length
    if ($size -lt 1024) { throw "Backup looks empty ($size bytes) - refusing to continue." }
    Write-Host ("  ok ({0} MB)" -f [math]::Round($size/1MB, 2)) -ForegroundColor Green
}

# ── Apply ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Re-asserting schema objects from db_scripts/..." -ForegroundColor Cyan
foreach ($f in $targets) { Invoke-File (Join-Path $DbRoot $f) $f }

# ── Done ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  version   : $(Invoke-Scalar 'SELECT version FROM public.schema_versions ORDER BY applied_at DESC LIMIT 1')"
if ($dumpName) {
    Write-Host "  backup    : db_backups/$dumpName"
    $restoreConn = if ($DbHost) { "-h $DbHost -p $Port -U $User" } else { "-U $User" }
    Write-Host "  rollback  : docker exec -i $ContainerName pg_restore $restoreConn -d $Database --clean --if-exists < db_backups/$dumpName" -ForegroundColor DarkGray
}
