#Requires -Version 7
<#
.SYNOPSIS
    Backs up the Enterprise PRODUCTION database (path from ecosystem.config.js)
    with backup-db.js, into backups\production at the repo root.

.DESCRIPTION
    Used by the "DeskSOS Enterprise Daily Backup" task. Production backups go
    to their own folder so they're never mixed with (or pruned by) development
    backups in backups\. Keeps the newest 14 (BACKUP_KEEP). Log:
    backend/server/logs/backup.log

    Before production's first start there's nothing to back up (exit 0). Once
    backups exist, a missing database means it was lost: that fails loudly.
#>
$ErrorActionPreference = 'Stop'
$server = (Resolve-Path "$PSScriptRoot\..").Path
$repo = (Resolve-Path "$server\..\..").Path
Set-Location $server
New-Item -ItemType Directory -Force (Join-Path $server "logs") | Out-Null
$log = Join-Path $server "logs\backup.log"

$dbSetting = node -p "require('./ecosystem.config.js').apps[0].env_production.DATABASE_PATH"
$db = if ([IO.Path]::IsPathRooted($dbSetting)) { $dbSetting } else { Join-Path $server $dbSetting }
$env:DATABASE_PATH = $db
$env:BACKUP_DIR = $env:BACKUP_DIR ?? (Join-Path $repo "backups\production")

if (-not (Test-Path $db)) {
    if (Get-ChildItem $env:BACKUP_DIR -Filter "enterprise-*.db" -ErrorAction SilentlyContinue) {
        "$(Get-Date -Format s) ERROR: production database missing ($db) but earlier backups exist." | Tee-Object -FilePath $log -Append
        exit 1
    }
    "$(Get-Date -Format s) No production database yet ($db); nothing to back up." | Tee-Object -FilePath $log -Append
    exit 0
}

"$(Get-Date -Format s) Production backup starting ($db -> $env:BACKUP_DIR)" | Add-Content $log
node scripts/backup-db.js *>&1 | Tee-Object -FilePath $log -Append
exit $LASTEXITCODE
