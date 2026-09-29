<#
.SYNOPSIS
  Calls the partner (public) API: Get Leads, Find Leads, Get Users, Get Branches.

.DESCRIPTION
  Authenticates with an iam.api_clients key (issued on the admin API Tokens
  screen). The key must carry the scope for the endpoint:
    Leads     -> leads:list      FindLeads -> leads:find
    Users     -> users:read      Branches  -> branches:read
  The tenant always comes from the key; there is no tenant parameter. Branch
  filters must be within the branches the key was issued for (else HTTP 400).

  Works on Windows PowerShell 5.1 and PowerShell 7+.

.EXAMPLE
  # Key from an env var (preferred - keeps it out of shell history)
  $env:FC_API_KEY = 'crmk_live_...'
  .\Invoke-PublicApi.ps1 -Api Branches -Environment uat

.EXAMPLE
  .\Invoke-PublicApi.ps1 -Api Leads -StartDate 2026-09-01 -EndDate 2026-09-30 -Stage new,contacted -All

.EXAMPLE
  .\Invoke-PublicApi.ps1 -Api FindLeads -Phones '+91 98765 43210','9812345678' -Emails 'a@b.com'

.EXAMPLE
  .\Invoke-PublicApi.ps1 -Api Users -DepartmentId <uuid> -BranchId <uuid>,<uuid> -OutFile users.csv

.EXAMPLE
  # Dot-source to use the functions directly
  . .\Invoke-PublicApi.ps1 -Api None
  Get-FcLeads -Source meta -Limit 50
#>
[CmdletBinding()]
param(
  [ValidateSet('Leads', 'FindLeads', 'Users', 'Branches', 'None')]
  [string]   $Api = 'Branches',

  [ValidateSet('local', 'uat', 'prod')]
  [string]   $Environment = 'local',
  [string]   $BaseUrl,                    # overrides -Environment
  [string]   $ApiKey = $env:FC_API_KEY,

  # Common
  [string[]] $BranchId,

  # Leads
  [string[]] $AssignedTo,
  [string]   $StartDate,                  # YYYY-MM-DD (branch-local day) or ISO timestamp with offset
  [string]   $EndDate,                    # YYYY-MM-DD is inclusive of that whole day
  [string[]] $Source,                     # uuid or catalog name, e.g. meta
  [string[]] $Stage,                      # uuid or catalog name, e.g. new
  [string[]] $Outcome,                    # uuid or catalog name
  [switch]   $IncludeInactive,            # also return superseded leads (Leads, FindLeads)
  [ValidateRange(1, 500)]
  [int]      $Limit = 100,
  [int]      $Offset = 0,
  [switch]   $All,                        # Leads: follow pagination to the end

  # FindLeads
  [string[]] $Phones,
  [string[]] $Emails,

  # Users
  [string[]] $DepartmentId,
  [string[]] $ManagerId,

  # Branches
  [string[]] $CountryId,
  [string[]] $StateId,
  [string[]] $CityId,

  # Output
  [string]   $OutFile,                    # .csv or .json; otherwise objects go to the pipeline
  [switch]   $Raw                         # return the whole response envelope, not just data
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 defaults to TLS 1.0/1.1, which the UAT/prod hosts refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:FcBaseUrls = @{
  local = 'http://localhost:4000'
  uat   = 'https://api-uat.fitclass.in'
  prod  = 'https://api.fitclass.in'
}

function Get-FcBaseUrl {
  if ($BaseUrl) { return $BaseUrl.TrimEnd('/') }
  return $script:FcBaseUrls[$Environment]
}

function Get-FcHeaders {
  if (-not $ApiKey) {
    throw 'No API key. Set $env:FC_API_KEY or pass -ApiKey (issue one on the admin API Tokens screen).'
  }
  return @{ Authorization = "Bearer $ApiKey"; Accept = 'application/json' }
}

# Builds ?a=1&b=x,y from a hashtable, skipping empty values. Arrays become csv.
function ConvertTo-FcQuery([hashtable] $Params) {
  $parts = @()
  foreach ($k in ($Params.Keys | Sort-Object)) {
    $v = $Params[$k]
    if ($null -eq $v) { continue }
    if ($v -is [array]) {
      $v = ($v | Where-Object { $_ } | ForEach-Object { "$_".Trim() }) -join ','
    }
    if ("$v" -eq '') { continue }
    $parts += ('{0}={1}' -f $k, [uri]::EscapeDataString("$v"))
  }
  if ($parts.Count -eq 0) { return '' }
  return '?' + ($parts -join '&')
}

# One HTTP call. Surfaces the API's { success:false, error, details } body on
# 4xx/5xx instead of PowerShell's generic "The remote server returned an error".
function Invoke-FcRequest {
  param([string] $Method, [string] $Path, [object] $Body)

  $uri = (Get-FcBaseUrl) + $Path
  $req = @{ Method = $Method; Uri = $uri; Headers = (Get-FcHeaders); UseBasicParsing = $true }
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    # Send UTF-8 bytes explicitly: 5.1 would otherwise encode the string as ISO-8859-1.
    $req['Body'] = [Text.Encoding]::UTF8.GetBytes($json)
    $req['ContentType'] = 'application/json; charset=utf-8'
  }
  Write-Verbose "$Method $uri"

  try {
    return Invoke-RestMethod @req
  } catch {
    $status = $null
    $detail = $_.ErrorDetails.Message            # PowerShell 7 puts the body here
    $resp = $_.Exception.Response
    if ($resp) {
      try { $status = [int]$resp.StatusCode } catch { }
      if (-not $detail -and $resp -is [Net.HttpWebResponse]) {   # Windows PowerShell 5.1
        try {
          $reader = New-Object IO.StreamReader($resp.GetResponseStream())
          $detail = $reader.ReadToEnd()
        } catch { }
      }
    }
    $hint = switch ($status) {
      401 { ' (key missing, invalid, revoked or expired)' }
      403 { ' (key lacks the scope for this endpoint - tick it on the API Tokens screen)' }
      429 { ' (per-key rate limit hit - slow down)' }
      default { '' }
    }
    throw "HTTP $status$hint on $Method $uri`n$detail"
  }
}

function Get-FcLeads {
  param(
    [string[]] $BranchId, [string[]] $AssignedTo, [string] $StartDate, [string] $EndDate,
    [string[]] $Source, [string[]] $Stage, [string[]] $Outcome,
    [switch] $IncludeInactive, [int] $Limit = 100, [int] $Offset = 0, [switch] $All, [switch] $Raw
  )
  $collected = @()
  do {
    $q = ConvertTo-FcQuery @{
      branch_id = $BranchId; assigned_to = $AssignedTo
      start_date = $StartDate; end_date = $EndDate
      source = $Source; stage = $Stage; outcome = $Outcome
      include_inactive = $(if ($IncludeInactive) { 'true' } else { $null })
      limit = $Limit; offset = $Offset
    }
    $res = Invoke-FcRequest -Method GET -Path "/public/v1/leads$q"
    if ($Raw -and -not $All) { return $res }
    $page = @($res.data)
    $collected += $page
    Write-Verbose ("leads {0}-{1} of {2}" -f $Offset, ($Offset + $page.Count), $res.total)
    $Offset += $page.Count
  } while ($All -and $page.Count -gt 0 -and $Offset -lt [int]$res.total)
  return $collected
}

function Find-FcLeads {
  param([string[]] $Phones, [string[]] $Emails, [string[]] $BranchId, [switch] $IncludeInactive, [switch] $Raw)
  if (-not $Phones -and -not $Emails) { throw 'FindLeads needs -Phones and/or -Emails.' }
  $body = @{
    phones = @($Phones | Where-Object { $_ })
    emails = @($Emails | Where-Object { $_ })
    include_inactive = [bool]$IncludeInactive
  }
  if ($BranchId) { $body['branch_id'] = @($BranchId) }
  $res = Invoke-FcRequest -Method POST -Path '/public/v1/leads/find' -Body $body
  if ($Raw) { return $res }
  $nf = $res.not_found
  if ($nf -and ((@($nf.phones).Count + @($nf.emails).Count) -gt 0)) {
    Write-Host ("Not found - phones: [{0}]  emails: [{1}]" -f (@($nf.phones) -join ', '), (@($nf.emails) -join ', ')) -ForegroundColor Yellow
  }
  return @($res.data)
}

function Get-FcUsers {
  param([string[]] $BranchId, [string[]] $DepartmentId, [string[]] $ManagerId, [switch] $Raw)
  $q = ConvertTo-FcQuery @{ branch_id = $BranchId; department_id = $DepartmentId; manager_id = $ManagerId }
  $res = Invoke-FcRequest -Method GET -Path "/public/v1/users$q"
  if ($Raw) { return $res }
  return @($res.data)
}

function Get-FcBranches {
  param([string[]] $BranchId, [string[]] $CountryId, [string[]] $StateId, [string[]] $CityId, [switch] $Raw)
  $q = ConvertTo-FcQuery @{ branch_id = $BranchId; country_id = $CountryId; state_id = $StateId; city_id = $CityId }
  $res = Invoke-FcRequest -Method GET -Path "/public/v1/branches$q"
  if ($Raw) { return $res }
  return @($res.data)
}

# ── Dispatch ────────────────────────────────────────────────────────────────
if ($Api -eq 'None') { return }   # dot-sourced for the functions only

$result = switch ($Api) {
  'Leads' {
    Get-FcLeads -BranchId $BranchId -AssignedTo $AssignedTo -StartDate $StartDate -EndDate $EndDate `
      -Source $Source -Stage $Stage -Outcome $Outcome -IncludeInactive:$IncludeInactive `
      -Limit $Limit -Offset $Offset -All:$All -Raw:$Raw
  }
  'FindLeads' { Find-FcLeads -Phones $Phones -Emails $Emails -BranchId $BranchId -IncludeInactive:$IncludeInactive -Raw:$Raw }
  'Users'     { Get-FcUsers -BranchId $BranchId -DepartmentId $DepartmentId -ManagerId $ManagerId -Raw:$Raw }
  'Branches'  { Get-FcBranches -BranchId $BranchId -CountryId $CountryId -StateId $StateId -CityId $CityId -Raw:$Raw }
}

if ($OutFile) {
  if ($OutFile -like '*.csv') {
    # matched_on is an array on FindLeads rows; flatten it for CSV.
    $result | ForEach-Object {
      $row = $_
      if ($row.PSObject.Properties['matched_on']) { $row.matched_on = (@($row.matched_on) -join '|') }
      $row
    } | Export-Csv -Path $OutFile -NoTypeInformation -Encoding UTF8
  } else {
    $result | ConvertTo-Json -Depth 6 | Out-File -FilePath $OutFile -Encoding utf8
  }
  Write-Host ("Wrote {0} row(s) to {1}" -f @($result).Count, $OutFile) -ForegroundColor Green
} else {
  $result
}
