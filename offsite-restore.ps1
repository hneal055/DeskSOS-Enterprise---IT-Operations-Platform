#Requires -Version 7
<#
.SYNOPSIS
    Turns an encrypted off-machine copy (*.db.enc from offsite-backup.ps1) back
    into a normal SQLite backup file, then checks it.

.DESCRIPTION
    Works on any PC with PowerShell 7 and a copy of this repository: for
    example a replacement server after the original was lost. Needs the backup
    passphrase: from DESKSOS_BACKUP_PASSPHRASE if set, otherwise it asks in a
    pop-up box. A wrong passphrase or a damaged file is refused (AES-GCM).

    The output is a plain backup, the same as the nightly ones. Put it back
    into production with the restore steps in docs/OPERATIONS.md (Enterprise
    5.2; Desktop: its runbook 4.4), or check it first with restore-drill.ps1 -Backup.

.EXAMPLE
    pwsh .\offsite-restore.ps1 -File "$env:OneDrive\DeskSOS-Backups\Enterprise\daily\enterprise-2026-10-08T07-30-02.db.enc" -OutFile C:\Restore\enterprise.db
#>
param(
    [Parameter(Mandatory)] [string]$File,
    [Parameter(Mandatory)] [string]$OutFile
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'offsite-backup.ps1')   # loads Protect-Bytes / Unprotect-Bytes only

if (-not (Test-Path $File)) { Write-Host "File not found: $File" -ForegroundColor Red; exit 1 }
if (Test-Path $OutFile) { Write-Host "$OutFile already exists; choose another name." -ForegroundColor Red; exit 1 }

$pass = $env:DESKSOS_BACKUP_PASSPHRASE ?? [Environment]::GetEnvironmentVariable('DESKSOS_BACKUP_PASSPHRASE', 'User')
if (-not $pass) {
    $c = Get-Credential -UserName 'DeskSOS backup' -Message 'Enter the backup passphrase (from your password manager)'
    $pass = $c.GetNetworkCredential().Password
}

try {
    $plain = Unprotect-Bytes ([IO.File]::ReadAllBytes($File)) $pass
} catch {
    Write-Host "Couldn't decrypt: wrong passphrase, or the file is damaged or not a DeskSOS copy." -ForegroundColor Red
    exit 1
}
# A real SQLite database starts with this header; check before writing anything
$header = [Text.Encoding]::ASCII.GetString($plain, 0, [Math]::Min(15, $plain.Length))
if ($header -ne 'SQLite format 3') { Write-Host "Decrypted, but the result isn't a SQLite database; nothing written." -ForegroundColor Red; exit 1 }

New-Item -ItemType Directory -Force (Split-Path -Parent ([IO.Path]::GetFullPath($OutFile))) | Out-Null
[IO.File]::WriteAllBytes($OutFile, $plain)
Write-Host ("Restored {0} ({1:N0} KB) to {2}" -f (Split-Path $File -Leaf), ($plain.Length / 1KB), $OutFile) -ForegroundColor Green
Write-Host "Next: check it with the product's restore-drill.ps1 -Backup `"$OutFile`", then follow the restore steps in its runbook."
exit 0
