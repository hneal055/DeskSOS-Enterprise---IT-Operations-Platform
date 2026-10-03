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
pm2 describe desksos-enterprise-backend | Out-Null
if ($LASTEXITCODE -ne 0) {
    pm2 start backend\server\dist\index.js --name desksos-enterprise-backend
}
else {
    pm2 restart desksos-enterprise-backend
}

# Step 3: Diagnostic Health Check Loop
Write-Host "[3/4] Performing API Gateway & Services Diagnostic Check..." -ForegroundColor Yellow
$maxRetries = 6
$retryCount = 0
$healthOk = $false

while ($retryCount -lt $maxRetries -and -not$healthOk) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:5000/health" -Method Get -ErrorAction Stop
        if ($response.status -eq "ok") {
            $healthOk = $true
            Write-Host "Backend Health Check Passed!" -ForegroundColor Green
            Write-Host "  -> Gateway Status: Online" -ForegroundColor Cyan
            Write-Host "  -> Database: $($response.services.database)" -ForegroundColor Cyan
            Write-Host "  -> Cache: $($response.services.cache)" -ForegroundColor Cyan
        }
    }
    catch {
        $retryCount++
        Write-Host "  [Attempt $retryCount/$maxRetries] Waiting for backend gateway on port 5000..." -ForegroundColor DarkYellow
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