# DeskSOS: rotate the ingest API key shared by Enterprise and Desktop
# File: rotate-ingest-key.ps1
#
# Generates a new random key and writes it to BOTH places at once:
#   Enterprise  backend\server\.env       INGEST_API_KEY=...
#   Desktop     backend\.env              ENTERPRISE_INGEST_KEY=...
# The key is never printed.
#
# Afterwards restart both backends (order doesn't matter). Tickets created on
# Desktop while only one side has restarted get a 401, stay in Desktop's
# outbox and are delivered automatically once both sides use the new key.
#
# Usage:
#   .\rotate-ingest-key.ps1
#   .\rotate-ingest-key.ps1 -DesktopEnv D:\path\to\DESKSOS-Desktop\backend\.env

param(
    [string]$EnterpriseEnv = (Join-Path $PSScriptRoot "backend\server\.env"),
    [string]$DesktopEnv = "C:\Projects\DESKSOS-Desktop\backend\.env"
)

$ErrorActionPreference = 'Stop'

function Set-EnvValue([string[]]$lines, [string]$name, [string]$value) {
    $found = $false
    $out = foreach ($l in $lines) {
        if ($l -match "^\s*$name=") { $found = $true; "$name=$value" } else { $l }
    }
    if (-not $found) { $out = @($out) + "$name=$value" }
    return , $out
}

# Check both files before changing either, so they can't end up mismatched
foreach ($f in $EnterpriseEnv, $DesktopEnv) {
    if (-not (Test-Path $f)) { throw "Not found: $f" }
    if ((Get-Item $f).IsReadOnly) { throw "Read-only: $f" }
}

# RandomNumberGenerator.Create().GetBytes works in both Windows PowerShell 5.1
# (.NET Framework) and PowerShell 7; the static Fill() is 7-only.
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$key = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')

# Keep the originals byte-for-byte so a failure part-way can be undone
$entOriginal = [IO.File]::ReadAllBytes($EnterpriseEnv)
$deskOriginal = [IO.File]::ReadAllBytes($DesktopEnv)

$read = {
    param($file, $name)
    $m = Select-String $file -Pattern "^\s*$name=(.*)$" | Select-Object -First 1
    if ($m) { $m.Matches[0].Groups[1].Value.Trim() }
}

$written = @()
try {
    Set-Content $EnterpriseEnv (Set-EnvValue (Get-Content $EnterpriseEnv) 'INGEST_API_KEY' $key)
    $written += 'enterprise'
    Set-Content $DesktopEnv (Set-EnvValue (Get-Content $DesktopEnv) 'ENTERPRISE_INGEST_KEY' $key)
    $written += 'desktop'
    # Verify both files now hold the same, new key
    $a = & $read $EnterpriseEnv 'INGEST_API_KEY'
    $b = & $read $DesktopEnv 'ENTERPRISE_INGEST_KEY'
    if ($a -ne $key -or $b -ne $key) { throw "the two files don't hold the new key" }
} catch {
    $reason = $_.Exception.Message
    # Put back every file this run changed, so the keys can't end up mismatched
    $notRestored = @()
    if ($written -contains 'enterprise') {
        try { [IO.File]::WriteAllBytes($EnterpriseEnv, $entOriginal) } catch { $notRestored += $EnterpriseEnv }
    }
    if ($written -contains 'desktop') {
        try { [IO.File]::WriteAllBytes($DesktopEnv, $deskOriginal) } catch { $notRestored += $DesktopEnv }
    }
    if ($notRestored) {
        throw "Rotation failed ($reason) and these files could NOT be restored; fix them by hand: $($notRestored -join ', ')"
    }
    throw "Rotation failed and both files were left as they were: $reason"
}

Write-Host "Ingest key rotated (length $($key.Length)); both .env files updated and verified." -ForegroundColor Green
Write-Host "Now restart both backends, from an Administrator window:" -ForegroundColor Yellow
Write-Host "  Enterprise: .\stop-dev.ps1 ; .\start-dev.ps1   (production: its start script)"
Write-Host "  Desktop:    restart its backend (dev: Ctrl+C then npm run dev; production: start-production.ps1)"
Write-Host "Tickets created in between are queued by Desktop and delivered once both have restarted."
