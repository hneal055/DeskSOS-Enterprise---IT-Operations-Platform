# DeskSOS Optimized Data & Config Backup Script
# Path: C:\Projects\DESKSOS\backup-desksos.ps1

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = "C:\Projects\DESKSOS\backups"
$backupDir = "$backupRoot\backup_$timestamp"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   DeskSOS Rapid Data Backup             " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Create backup directory
if (!(Test-Path $backupDir)) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
}

$backedUpCount = 0

# 1. Backup Environment Configuration Files (.env)
$envFiles = Get-ChildItem -Path "C:\Projects\DESKSOS" -Recurse -Filter ".env" -ErrorAction SilentlyContinue
foreach ($file in $envFiles) {
    # Skip node_modules or backup folders if any match
    if ($file.FullName -like "*node_modules*" -or $file.FullName -like "*backups*") { continue }
    
    $configDest = "$backupDir\config"
    if (!(Test-Path $configDest)) { New-Item -ItemType Directory -Force -Path $configDest | Out-Null }
    Copy-Item $file.FullName -Destination $configDest -Force
    Write-Host " -> Backed up config: $($file.Directory.Name)/.env" -ForegroundColor Green
    $backedUpCount++
}

# 2. Backup SQLite Database Files (*.db)
$dbFiles = Get-ChildItem -Path "C:\Projects\DESKSOS" -Recurse -Filter "*.db" -ErrorAction SilentlyContinue
foreach ($file in $dbFiles) {
    if ($file.FullName -like "*node_modules*" -or $file.FullName -like "*backups*") { continue }

    $dbDest = "$backupDir\database"
    if (!(Test-Path $dbDest)) { New-Item -ItemType Directory -Force -Path $dbDest | Out-Null }
    Copy-Item $file.FullName -Destination $dbDest -Force
    Write-Host " -> Backed up database: $($file.Name)" -ForegroundColor Green
    $backedUpCount++
}

Write-Host "=========================================" -ForegroundColor Cyan
if ($backedUpCount -gt 0) {
    Write-Host " Backup completed successfully in < 1s!" -ForegroundColor Green
    Write-Host " Location: $backupDir" -ForegroundColor Gray
}
else {
    Write-Host " Warning: No database or .env files found to backup." -ForegroundColor Yellow
}
Write-Host "=========================================" -ForegroundColor Cyan