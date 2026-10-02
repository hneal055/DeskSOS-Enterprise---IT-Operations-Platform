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

# 1. Teardown old PM2 instances
Write-Host "[2/6] Clearing existing PM2 processes..." -ForegroundColor Yellow
pm2 delete all 2>$null
pm2 kill 2>$null

# 2. Free up Port 5000 conflicts
Write-Host "[3/6] Checking and clearing port 5000..." -ForegroundColor Yellow
$port = 5000
$processId = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess
if ($processId) {
    Stop-Process -Id $processId -Force
    Write-Host " -> Terminated process PID $processId holding port $port." -ForegroundColor Green
}
else {
    Write-Host " -> Port $port is completely free." -ForegroundColor Green
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
pm2 start dist/index.js --name "desksos-backend"
pm2 save

# 5. Display live status
Write-Host "[6/6] Verification Status:" -ForegroundColor Yellow
pm2 status

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " DeskSOS Backend is Live and Synced!     " -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan