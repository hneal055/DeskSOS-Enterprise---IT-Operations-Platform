# DeskSOS Enterprise database backup
# Path: C:\Projects\DESKSOS\backup-desksos.ps1
#
# Takes a verified online backup of the Enterprise SQLite database into
# backups\ (ignored by git). See backend\server\scripts\backup-db.js.
#
# .env files are intentionally NOT copied: backups must never hold secrets.
# Keep secrets in a password manager or another protected location instead.

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   DeskSOS Enterprise Database Backup    " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

node "$PSScriptRoot\backend\server\scripts\backup-db.js"
$code = $LASTEXITCODE

Write-Host "=========================================" -ForegroundColor Cyan
if ($code -eq 0) {
    Write-Host " Backup completed and verified." -ForegroundColor Green
}
else {
    Write-Host " Backup FAILED (exit code $code). See the message above." -ForegroundColor Red
}
Write-Host "=========================================" -ForegroundColor Cyan
exit $code
