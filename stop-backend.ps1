# DeskSOS Shutdown & Cleanup Script
# Path: C:\Projects\DESKSOS\stop-backend.ps1

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   DeskSOS Backend Orderly Shutdown      " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Trigger a safety hot-backup of the SQLite database
$backupScript = "C:\Projects\DESKSOS\backup-desksos.ps1"
if (Test-Path $backupScript) {
    Write-Host "[1/4] Running safety database backup..." -ForegroundColor Yellow
    & pwsh -File $backupScript
}
else {
    Write-Host "[1/4] Backup script not found, skipping hot backup." -ForegroundColor Gray
}

# 2. Stop and delete PM2 backend process
Write-Host "[2/4] Stopping PM2 backend service..." -ForegroundColor Yellow
pm2 stop desksos-backend 2>$null
pm2 delete desksos-backend 2>$null
pm2 save 2>$null

# 3. Ensure Port 5000 is fully released
Write-Host "[3/4] Releasing port 5000..." -ForegroundColor Yellow
$port = 5000
$processId = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess
if ($processId) {
    Stop-Process -Id $processId -Force
    Write-Host " -> Terminated lingering process PID $processId on port $port." -ForegroundColor Green
}
else {
    Write-Host " -> Port $port is already free." -ForegroundColor Green
}

Write-Host "[4/4] Environment successfully shut down and secured." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " DeskSOS is ready for a clean restart!   " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan