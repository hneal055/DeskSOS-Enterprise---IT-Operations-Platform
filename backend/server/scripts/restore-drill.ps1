#Requires -Version 7
<#
.SYNOPSIS
    Restore drill for DeskSOS Enterprise (readiness plan task 3.3): proves a
    backup can be restored and served, without touching production.

.DESCRIPTION
    1. Picks a backup (the newest in backups\production unless -Backup is given)
    2. Copies it to a scratch folder and runs PRAGMA integrity_check
    3. Counts incidents, users and history events
    4. Starts a throwaway server on that copy (a free port, plain HTTP, a
       temporary secret) and checks /health and that the incident list is served
    5. Stops the server, deletes the scratch folder, and appends the result
       to backend\server\logs\restore-drill.log

    Production's process, database, port and secrets are never used. Needs the
    built server (dist\). No administrator rights needed.

.EXAMPLE
    pwsh backend\server\scripts\restore-drill.ps1
    pwsh backend\server\scripts\restore-drill.ps1 -Backup C:\path\to\enterprise-2026-10-06T07-30-02.db
#>
param(
    [string]$Backup,
    [int]$Port = 5199
)

$ErrorActionPreference = 'Stop'
$server = (Resolve-Path "$PSScriptRoot\..").Path
$repo = (Resolve-Path "$server\..\..").Path
$log = Join-Path $server 'logs\restore-drill.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

function Result([bool]$ok, [string]$detail) {
    $line = "{0}  {1}  {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), ($ok ? 'PASS' : 'FAIL'), $detail
    Add-Content -Path $log -Value $line
    Write-Host $line -ForegroundColor ($ok ? 'Green' : 'Red')
    exit ($ok ? 0 : 1)
}

if (-not $Backup) {
    $Backup = Get-ChildItem (Join-Path $repo 'backups\production') -Filter '*.db' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Backup) { Result $false "no backup found in backups\production" }
if (-not (Test-Path $Backup)) { Result $false "backup file not found: $Backup" }
if (-not (Test-Path (Join-Path $server 'dist\index.js'))) { Result $false "no build: run npm run build in backend\server" }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Result $false "port $Port is in use; pass -Port" }

$scratch = Join-Path ([IO.Path]::GetTempPath()) ("desksos-restore-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $scratch | Out-Null
$db = Join-Path $scratch 'restored.db'
$proc = $null
try {
    Copy-Item $Backup $db
    Write-Host "Backup:  $Backup"

    # Integrity and record counts (read-only)
    $check = @'
const Database = require(process.argv[1]);
let db;
try { db = new Database(process.argv[2], { readonly: true, fileMustExist: true }); db.pragma("schema_version"); }
catch (e) { console.log(JSON.stringify({ error: e.message })); process.exit(0); }
const integrity = db.pragma("integrity_check", { simple: true });
const n = (t) => { try { return db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; } catch { return -1; } };
console.log(JSON.stringify({ integrity, incidents: n("incidents"), users: n("users"), events: n("incident_events") }));
'@
    $counts = node -e $check (Join-Path $server 'node_modules\better-sqlite3') $db | ConvertFrom-Json
    if ($counts.error) { Result $false "not a readable SQLite database: $($counts.error) ($Backup)" }
    Write-Host ("Check:   integrity {0}; {1} incidents, {2} users, {3} history events" -f $counts.integrity, $counts.incidents, $counts.users, $counts.events)
    if ($counts.integrity -ne 'ok') { Result $false "integrity_check: $($counts.integrity) ($Backup)" }
    if ($counts.users -lt 1) { Result $false "no user accounts in the backup ($Backup)" }

    # Serve it from a throwaway process: its own port, HTTP, temporary secret,
    # and no production settings (NODE_ENV=development, no .env.production)
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $psi = [Diagnostics.ProcessStartInfo]::new('node', (Join-Path $server 'dist\index.js'))
    $psi.WorkingDirectory = $scratch      # so no .env file is picked up from the current directory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($k in 'TLS_CERT_PATH', 'TLS_KEY_PATH', 'INGEST_API_KEY', 'SERVE_CLIENT') { $psi.Environment[$k] = '' }
    $psi.Environment['NODE_ENV'] = 'development'
    $psi.Environment['PORT'] = "$Port"
    $psi.Environment['DATABASE_PATH'] = $db
    $psi.Environment['JWT_SECRET'] = [Convert]::ToBase64String($bytes)
    $psi.Environment['LOG_LEVEL'] = 'warn'
    $proc = [Diagnostics.Process]::Start($psi)

    $health = $null
    for ($i = 0; $i -lt 30 -and -not $health; $i++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod "http://localhost:$Port/health" -TimeoutSec 2 } catch { }
        if ($proc.HasExited) { break }
    }
    if (-not $health -or $health.status -ne 'ok') { Result $false "restored server did not report healthy ($Backup)" }
    # The incident list must be protected, i.e. the API is really serving
    $code = try { (Invoke-WebRequest "http://localhost:$Port/api/incidents" -TimeoutSec 5 -SkipHttpErrorCheck).StatusCode } catch { 0 }
    if ($code -ne 401) { Result $false "restored server: /api/incidents returned $code, expected 401 ($Backup)" }

    Result $true ("{0}: integrity ok, {1} incidents, {2} users, {3} events; served healthy on :{4}" -f (Split-Path $Backup -Leaf), $counts.incidents, $counts.users, $counts.events, $Port)
}
finally {
    if ($proc -and -not $proc.HasExited) { $proc.Kill($true); $proc.WaitForExit(5000) | Out-Null }
    Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
