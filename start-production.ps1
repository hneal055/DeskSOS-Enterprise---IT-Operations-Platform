#Requires -Version 7
# DeskSOS Enterprise - production start (or restart) under PM2
# File: start-production.ps1
#
# Run from an Administrator PowerShell 7 window. Safe to run again: it
# rebuilds, re-registers the PM2 process and checks health each time.
#
#   .\start-production.ps1              # build and (re)start production
#   .\start-production.ps1 -SkipBuild   # restart the existing build (used at boot)
#
# Production: https://<this PC>:5543, database backend\server\data\enterprise-prod.db,
# PM2 name desksos-enterprise. Settings: backend\server\ecosystem.config.js.
# Secrets: backend\server\.env.production (created here if missing).

param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Server = Join-Path $Root 'backend\server'
$Client = Join-Path $Root 'client'
# Test overrides (see ecosystem.config.js); production uses the defaults
$Name = if ($env:DESKSOS_PROD_NAME) { $env:DESKSOS_PROD_NAME } else { 'desksos-enterprise' }
$Port = if ($env:DESKSOS_PROD_PORT) { [int]$env:DESKSOS_PROD_PORT } else { 5543 }

function Step($n, $text) { Write-Host "`n[$n/7] $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "  FAILED: $text" -ForegroundColor Red; exit 1 }

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "   DeskSOS Enterprise - Production Start         " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. PM2 must be reachable from this window (same checks as start-dev.ps1)
Step 1 "Checking PM2..."
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { Fail "PM2 isn't installed (npm install -g pm2)" }
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
$daemons = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match "pm2\\lib\\Daemon\.js" })
if ((Test-Path "\\.\pipe\rpc.sock") -and $daemons.Count -eq 0 -and -not $isElevated) {
    Fail "PM2 runs in an elevated session this window can't reach. Use an Administrator window."
}
if ($daemons.Count -gt 1) { Fail "$($daemons.Count) PM2 daemons are running (broken state). Run .\stop-dev.ps1 first." }
Write-Host "  -> OK" -ForegroundColor Green

# 2. Production secrets: its own JWT secret and ingest key, never printed
Step 2 "Checking production secrets..."
$envProd = Join-Path $Server '.env.production'
function New-Secret {
    $b = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($b) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($b).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}
$lines = if (Test-Path $envProd) { @(Get-Content $envProd) } else { @() }
$added = @()
foreach ($key in 'JWT_SECRET', 'INGEST_API_KEY') {
    if (-not ($lines -match "^\s*$key=.{32,}")) {
        $lines = @($lines | Where-Object { $_ -notmatch "^\s*$key=" }) + "$key=$(New-Secret)"
        $added += $key
    }
}
if ($added) {
    if (-not (Test-Path $envProd)) {
        $lines = @("# DeskSOS Enterprise production secrets (never commit). Created by start-production.ps1.") + $lines
    }
    Set-Content $envProd $lines
    Write-Host "  -> Generated $($added -join ', ') in backend\server\.env.production" -ForegroundColor Green
    if ($added -contains 'INGEST_API_KEY') {
        Write-Host "     Desktop production needs this key to forward tickets (plan task 2.8)." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  -> OK (backend\server\.env.production)" -ForegroundColor Green
}

# 3. HTTPS certificate
Step 3 "Checking the HTTPS certificate..."
$crt = Join-Path $Server 'certs\server.crt'
if (-not (Test-Path $crt) -or -not (Test-Path (Join-Path $Server 'certs\server.key'))) {
    Write-Host "  -> Not found; creating it with gen-cert.ps1" -ForegroundColor DarkYellow
    & (Join-Path $Server 'scripts\gen-cert.ps1')
    if (-not (Test-Path $crt)) { Fail "certificate creation failed" }
}
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $crt
$daysLeft = [int]($cert.NotAfter - (Get-Date)).TotalDays
if ($daysLeft -lt 0) { Fail "the certificate expired on $($cert.NotAfter.ToString('yyyy-MM-dd')). Run backend\server\scripts\gen-cert.ps1" }
$color = if ($daysLeft -lt 30) { 'DarkYellow' } else { 'Green' }
Write-Host "  -> OK, valid until $($cert.NotAfter.ToString('yyyy-MM-dd')) ($daysLeft days)" -ForegroundColor $color

# 4. Build
Step 4 "Building..."
if ($SkipBuild) {
    if (-not (Test-Path (Join-Path $Server 'dist\index.js')) -or -not (Test-Path (Join-Path $Client 'build\index.html'))) {
        Fail "-SkipBuild was given but there's no existing build"
    }
    Write-Host "  -> Skipped (using the existing build)" -ForegroundColor Gray
} else {
    foreach ($dir in $Server, $Client) {
        Push-Location $dir
        try {
            # Reinstall when packages are missing or the lockfile changed since the
            # last install (e.g. after a git pull), not only on the first run
            $installed = 'node_modules\.package-lock.json'
            if (-not (Test-Path $installed) -or
                (Get-Item package-lock.json).LastWriteTime -gt (Get-Item $installed).LastWriteTime) {
                npm ci; if ($LASTEXITCODE) { Fail "npm ci failed in $dir" }
            }
            npm run build; if ($LASTEXITCODE) { Fail "build failed in $dir" }
        } finally { Pop-Location }
    }
    Write-Host "  -> Backend and dashboard built" -ForegroundColor Green
}

# 5. Port: free, or held by our own previous instance (replaced below)
Step 5 "Checking port $Port..."
pm2 describe $Name 2>&1 | Out-Null
$registered = ($LASTEXITCODE -eq 0)
if ($registered) { pm2 delete $Name | Out-Null; Start-Sleep -Seconds 1 }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Fail "port $Port is held by another process. Free it, then retry."
}
Write-Host "  -> Free$(if ($registered) { ' (previous instance removed)' })" -ForegroundColor Green

# 6. Start under PM2 and persist the process list
Step 6 "Starting $Name under PM2..."
# Production's secrets must come from .env.production, never from a value
# inherited by this window (the server also enforces this)
$env:JWT_SECRET = $null
Push-Location $Server
try {
    pm2 start ecosystem.config.js --env production --only $Name
    if ($LASTEXITCODE) { Fail "PM2 failed to start $Name" }
    pm2 save | Out-Null
} finally { Pop-Location }

# 7. Health over HTTPS. -SkipCertificateCheck: this checks the service is up;
# the certificate itself was checked in step 3 and is validated by browsers.
Step 7 "Checking health at https://localhost:$Port/health ..."
$healthy = $false
for ($i = 1; $i -le 15 -and -not $healthy; $i++) {
    Start-Sleep -Seconds 2
    try {
        $h = Invoke-RestMethod "https://localhost:$Port/health" -SkipCertificateCheck -TimeoutSec 5
        $healthy = ($h.status -eq 'ok')
    } catch {}
}

Write-Host ""
if (-not $healthy) {
    Write-Host "=================================================" -ForegroundColor Red
    Write-Host "Production did NOT become healthy. Check: pm2 logs $Name" -ForegroundColor Red
    Write-Host "=================================================" -ForegroundColor Red
    exit 1
}
Write-Host "=================================================" -ForegroundColor Green
Write-Host "Production is up: https://$($env:COMPUTERNAME):$Port" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
# Ask PM2 for the real log path (it adds the process id to the file name)
$outLog = (pm2 jlist 2>$null | ConvertFrom-Json -AsHashtable | Where-Object { $_.name -eq $Name } |
    Select-Object -First 1).pm2_env.pm_out_log_path
if ($outLog -and (Test-Path $outLog) -and (Select-String $outLog -Pattern 'FIRST-RUN ADMIN' -Quiet)) {
    Write-Host "First start of this database: a one-time admin password was written to the log. Show it with:" -ForegroundColor Yellow
    Write-Host "  Select-String '$outLog' -Pattern 'Email:|Password:' | Select-Object -Last 2"
    Write-Host "Sign in and change it right away."
}
exit 0
