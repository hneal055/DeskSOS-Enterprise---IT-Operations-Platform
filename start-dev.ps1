# DeskSOS Enterprise - Enhanced Full Stack Development Startup Script
# File: start-dev.ps1

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "   DeskSOS Enterprise Development Launcher       " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# Run from the repo root regardless of the caller's current directory
Set-Location $PSScriptRoot

# Pre-flight: a PM2 daemon started from an elevated shell can't be reached from
# a non-elevated one. Calling pm2 anyway fails with EPERM and leaves an orphaned
# daemon behind each time, so stop here with guidance instead.
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
$visibleDaemons = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match "pm2\\lib\\Daemon\.js" })
if ((Test-Path "\\.\pipe\rpc.sock") -and $visibleDaemons.Count -eq 0 -and -not $isElevated) {
    Write-Host "`nPM2 is running in an elevated (Administrator) session and can't be reached from this shell." -ForegroundColor Red
    Write-Host "Re-run this script from an elevated terminal." -ForegroundColor Red
    exit 1
}
if ($visibleDaemons.Count -gt 1) {
    Write-Host "`nFound $($visibleDaemons.Count) PM2 daemons; PM2 is in a broken state." -ForegroundColor Red
    Write-Host "Run .\stop-dev.ps1 first to clean up, then retry." -ForegroundColor Red
    exit 1
}

# A client already on port 3000 would leave the new React window waiting at a
# "use another port?" prompt. Check before touching the running backend.
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "`nPort 3000 is already in use (is the dashboard still running?)." -ForegroundColor Red
    Write-Host "Run .\stop-dev.ps1 first, then retry." -ForegroundColor Red
    exit 1
}

# Step 1: Navigate to backend server directory and build TypeScript
Write-Host "`n[1/4] Building backend TypeScript..." -ForegroundColor Yellow
Push-Location backend\server
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend build failed! Aborting startup." -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Step 2: Start or Restart PM2 Backend Process
Write-Host "[2/4] Managing PM2 Backend Service..." -ForegroundColor Yellow
# Always re-register rather than 'pm2 restart': restart reuses the cwd and env
# saved when the process was first created, which can be stale.
pm2 describe desksos-enterprise-backend 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    pm2 delete desksos-enterprise-backend | Out-Null
    Start-Sleep -Seconds 1
}

# Checked only after the delete above, since our own previous backend holds
# 5100 until then. Anything else here would make the backend crash-loop with
# EADDRINUSE.
if (Get-NetTCPConnection -LocalPort 5100 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Port 5100 is held by another process. Run .\stop-dev.ps1 first, then retry." -ForegroundColor Red
    exit 1
}

pm2 start "$PSScriptRoot\backend\server\dist\index.js" --name desksos-enterprise-backend --cwd "$PSScriptRoot\backend\server"
if ($LASTEXITCODE -ne 0) {
    Write-Host "PM2 failed to start the backend. Aborting startup." -ForegroundColor Red
    exit 1
}

# Step 3: Diagnostic Health Check Loop
Write-Host "[3/4] Performing API Gateway & Services Diagnostic Check..." -ForegroundColor Yellow
$maxRetries = 6
$retryCount = 0
$healthOk = $false

while ($retryCount -lt $maxRetries -and -not $healthOk) {
    Start-Sleep -Seconds 2
    $retryCount++
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:5100/health" -Method Get -ErrorAction Stop
        if ($response.status -eq "ok") {
            $healthOk = $true
            Write-Host "Backend Health Check Passed!" -ForegroundColor Green
            Write-Host "  -> Gateway Status: Online" -ForegroundColor Cyan
            Write-Host "  -> Database: $($response.services.database)" -ForegroundColor Cyan
        }
        else {
            Write-Host "  [Attempt $retryCount/$maxRetries] Backend responded with status '$($response.status)'" -ForegroundColor DarkYellow
        }
    }
    catch {
        # A 503 means the server is up but its database check failed
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 503) {
            Write-Host "  [Attempt $retryCount/$maxRetries] Backend is up but the database is unavailable" -ForegroundColor DarkYellow
        }
        else {
            Write-Host "  [Attempt $retryCount/$maxRetries] Waiting for backend gateway on port 5100..." -ForegroundColor DarkYellow
        }
    }
}

if (-not $healthOk) {
    Write-Host "Warning: Health endpoint did not respond in time, but proceeding with client launch..." -ForegroundColor Yellow
}

# Step 4: Launch Log Monitoring & Frontend Client in dedicated windows
Write-Host "`n[4/4] Spinning up Log Monitor & React Frontend..." -ForegroundColor Yellow

# Opens a side window tailing live PM2 backend logs in real-time
Start-Process powershell -ArgumentList "-NoExit", "-Command", "pm2 logs desksos-enterprise-backend"

# Opens the React frontend client window from the client directory
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd client; npm start"

if ($healthOk) {
    Write-Host "`n=================================================" -ForegroundColor Green
    Write-Host "DeskSOS Suite is Live, Synced, and Monitored!" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
}
else {
    Write-Host "`n=================================================" -ForegroundColor Yellow
    Write-Host "Client launched, but the backend is NOT healthy." -ForegroundColor Yellow
    Write-Host "Check the PM2 log window, then run .\stop-dev.ps1 and retry." -ForegroundColor Yellow
    Write-Host "=================================================" -ForegroundColor Yellow
}