# DeskSOS Production Backend Automation Script with Git Sync
# Path: C:\Projects\DESKSOS\start-backend.ps1

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   DeskSOS Backend Startup & Git Sync    " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 0. Sync with Git repository
Write-Host "[1/6] Syncing with Git repository..." -ForegroundColor Yellow
git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host " -> Warning: Git pull encountered an issue or you are offline. Continuing with local version..." -ForegroundColor Magenta
}
else {
    Write-Host " -> Repository successfully updated." -ForegroundColor Green
}

# 1. Remove this project's PM2 process only. Other projects (e.g. DESKSOS-Desktop)
# share the PM2 daemon, so never use 'pm2 delete all' or 'pm2 kill' here.
$pm2Name = "desksos-enterprise-backend"
Write-Host "[2/6] Removing existing '$pm2Name' PM2 process..." -ForegroundColor Yellow
pm2 describe $pm2Name 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    pm2 delete $pm2Name 2>&1 | Out-Null
    Write-Host " -> Removed '$pm2Name' from PM2." -ForegroundColor Green
}
else {
    Write-Host " -> '$pm2Name' is not registered with PM2." -ForegroundColor Green
}

# 2. Free up Port 5000, but only if a DeskSOS backend is holding it
Write-Host "[3/6] Checking port 5000..." -ForegroundColor Yellow
$port = 5000
$processIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
if (-not $processIds) {
    Write-Host " -> Port $port is completely free." -ForegroundColor Green
}
foreach ($processId in $processIds) {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue).CommandLine
    if ($cmd -match "backend\\server\\dist" -or $cmd -match [regex]::Escape($PSScriptRoot)) {
        Stop-Process -Id $processId -Force
        Write-Host " -> Terminated stale DeskSOS backend PID $processId on port $port." -ForegroundColor Green
    }
    else {
        Write-Host " -> Port $port is held by another application (PID $processId): $cmd" -ForegroundColor Red
        Write-Host "    Not touching it. Free the port manually, then retry." -ForegroundColor Red
        exit 1
    }
}

# 3. Navigate to server directory and compile TypeScript
Write-Host "[4/6] Compiling TypeScript backend..." -ForegroundColor Yellow
$serverPath = "C:\Projects\DESKSOS\backend\server"
if (!(Test-Path $serverPath)) {
    Write-Error "Server directory not found at $serverPath!"
    exit 1
}
Set-Location $serverPath
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Error "TypeScript compilation failed. Aborting startup."
    exit 1
}

# 4. Launch under PM2 supervision
Write-Host "[5/6] Launching backend under PM2..." -ForegroundColor Yellow
pm2 start dist/index.js --name "desksos-enterprise-backend"
pm2 save

# 5. Display live status
Write-Host "[6/6] Verification Status:" -ForegroundColor Yellow
pm2 status

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " DeskSOS Backend is Live and Synced!     " -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan