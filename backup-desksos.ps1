# Backup DeskSOS project safely
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = "C:\Projects\DESKSOS_Backup_$timestamp"

Write-Host "Creating backup at $backupDir..."
Copy-Item "C:\Projects\DESKSOS" $backupDir -Recurse -Force
Write-Host "✅ Backup complete."
