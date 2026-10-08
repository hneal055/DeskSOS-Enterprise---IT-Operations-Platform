#Requires -Version 7
<#
.SYNOPSIS
    Off-machine backup copies for both DeskSOS products (readiness plan task
    3.2): encrypts the newest nightly backup of each and puts it in OneDrive.

.DESCRIPTION
    For DeskSOS Enterprise (backups\production) and DeskSOS Desktop
    (C:\Projects\DESKSOS-Desktop\backend\data\backups):
      1. takes the newest *.db backup
      2. encrypts it with AES-256-GCM; the key is derived from a passphrase
         (PBKDF2-SHA256, 600,000 iterations, random salt), and GCM also detects
         any tampering
      3. decrypts the new copy again and compares it with the original, so a
         copy that couldn't be restored never counts as a success
      4. stores it in <Destination>\<Product>\daily\ and, once a week, also in
         ...\weekly\; keeps the newest 14 daily and 8 weekly copies
    OneDrive then uploads the folder. Restore with offsite-restore.ps1.

    The passphrase comes from the user environment variable
    DESKSOS_BACKUP_PASSPHRASE (set once; see docs/OPERATIONS.md section 5.4).
    Keep a copy in a password manager: without it the copies can't be read.

    Any failure exits 1 and, if ALERT_DISCORD_WEBHOOK_URL is set, posts to Discord.
    Log: backend\server\logs\offsite.log. Scheduled daily at 03:15 by
    register-production-tasks.ps1 ("DeskSOS Enterprise Offsite Backup").

.EXAMPLE
    pwsh .\offsite-backup.ps1
    pwsh .\offsite-backup.ps1 -Destination D:\Backups\DeskSOS     # another folder
#>
param(
    [string]$Destination,   # default: <OneDrive>\DeskSOS-Backups (resolved below)
    [hashtable]$Sources = @{
        Enterprise = (Join-Path $PSScriptRoot 'backups\production')
        Desktop    = 'C:\Projects\DESKSOS-Desktop\backend\data\backups'
    },
    [int]$KeepDaily = 14,
    [int]$KeepWeekly = 8,
    [string]$LogFile = (Join-Path $PSScriptRoot 'backend\server\logs\offsite.log')
)

$ErrorActionPreference = 'Stop'
$Magic = [Text.Encoding]::ASCII.GetBytes('DSOSBK1')   # file format marker + version
$Iterations = 600000

function Write-Log([string]$m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"; Add-Content $LogFile $line; Write-Host $line }

function Send-Failure([string]$why) {
    $url = $env:ALERT_DISCORD_WEBHOOK_URL ?? [Environment]::GetEnvironmentVariable('ALERT_DISCORD_WEBHOOK_URL', 'User')
    if (-not $url) { return }
    try {
        $msg = @{ username = 'DeskSOS'; content = "**[DeskSOS] Off-machine backup FAILED**`n$why`n`nLog: backend\server\logs\offsite.log"; allowed_mentions = @{ parse = @() } }
        Invoke-RestMethod $url -Method Post -ContentType 'application/json' -Body ($msg | ConvertTo-Json -Depth 4) -TimeoutSec 15 | Out-Null
    } catch { Write-Log "  (Discord alert failed: $($_.Exception.Message))" }
}

function Fail([string]$why) { Write-Log "FAIL: $why"; Send-Failure $why; exit 1 }

# Format: magic(7) | salt(16) | nonce(12) | tag(16) | ciphertext
function Protect-Bytes([byte[]]$plain, [string]$pass) {
    $salt = [byte[]]::new(16); [Security.Cryptography.RandomNumberGenerator]::Fill($salt)
    $nonce = [byte[]]::new(12); [Security.Cryptography.RandomNumberGenerator]::Fill($nonce)
    $key = [Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2([Text.Encoding]::UTF8.GetBytes($pass), $salt, $Iterations, [Security.Cryptography.HashAlgorithmName]::SHA256, 32)
    $cipher = [byte[]]::new($plain.Length); $tag = [byte[]]::new(16)
    $gcm = [Security.Cryptography.AesGcm]::new($key, 16)
    try { $gcm.Encrypt($nonce, $plain, $cipher, $tag, $Magic) } finally { $gcm.Dispose() }
    # The leading comma stops PowerShell unrolling the array into object[]
    return , [byte[]]($Magic + $salt + $nonce + $tag + $cipher)
}

function Test-SameBytes([byte[]]$a, [byte[]]$b) {
    return $a.Length -eq $b.Length -and [Linq.Enumerable]::SequenceEqual([byte[]]$a, [byte[]]$b)
}

function Unprotect-Bytes([byte[]]$data, [string]$pass) {
    if ($data.Length -lt 51 -or -not (Test-SameBytes ([byte[]]$data[0..6]) $Magic)) { throw "not a DeskSOS encrypted backup" }
    $salt = [byte[]]$data[7..22]; $nonce = [byte[]]$data[23..34]; $tag = [byte[]]$data[35..50]
    $cipher = if ($data.Length -gt 51) { [byte[]]$data[51..($data.Length - 1)] } else { [byte[]]::new(0) }
    $key = [Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2([Text.Encoding]::UTF8.GetBytes($pass), $salt, $Iterations, [Security.Cryptography.HashAlgorithmName]::SHA256, 32)
    $plain = [byte[]]::new($cipher.Length)
    $gcm = [Security.Cryptography.AesGcm]::new($key, 16)
    try { $gcm.Decrypt($nonce, $cipher, $tag, $plain, $Magic) } finally { $gcm.Dispose() }
    return , $plain
}

# The restore script dot-sources this file for the two functions above
if ($MyInvocation.InvocationName -eq '.') { return }

New-Item -ItemType Directory -Force (Split-Path $LogFile) | Out-Null

# Never leave a half-written copy under a final name
function Publish-File([string]$tmp, [string]$final) { Move-Item $tmp $final -Force }

$partials = [Collections.Generic.List[string]]::new()
try {
    $pass = $env:DESKSOS_BACKUP_PASSPHRASE ?? [Environment]::GetEnvironmentVariable('DESKSOS_BACKUP_PASSPHRASE', 'User')
    if (-not $pass) { Fail "DESKSOS_BACKUP_PASSPHRASE isn't set (docs/OPERATIONS.md section 5.4)" }
    if ($pass.Length -lt 16) { Fail "DESKSOS_BACKUP_PASSPHRASE is shorter than 16 characters" }
    if (-not $Destination) {
        $oneDrive = [Environment]::GetEnvironmentVariable('OneDrive', 'User') ?? $env:OneDrive
        if (-not $oneDrive) { Fail "no destination: OneDrive isn't set up for this user (pass -Destination)" }
        $Destination = Join-Path $oneDrive 'DeskSOS-Backups'
    }

    Write-Log "Off-machine backup to $Destination"
    $done = 0
    foreach ($product in $Sources.Keys | Sort-Object) {
        $src = Get-ChildItem $Sources[$product] -Filter '*.db' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $src) { Fail "${product}: no backup found in $($Sources[$product])" }
        $age = (Get-Date) - $src.LastWriteTime
        if ($age.TotalHours -gt 36) { Fail "${product}: newest backup $($src.Name) is $([int]$age.TotalHours) hours old; the nightly backup isn't running" }

        $plain = [IO.File]::ReadAllBytes($src.FullName)
        $enc = Protect-Bytes $plain $pass
        # Prove the copy restores before trusting it
        $back = Unprotect-Bytes $enc $pass
        if (-not (Test-SameBytes $back $plain)) { Fail "${product}: encrypted copy didn't decrypt to the original" }

        $daily = Join-Path $Destination "$product\daily"; $weekly = Join-Path $Destination "$product\weekly"
        New-Item -ItemType Directory -Force $daily, $weekly | Out-Null
        $name = "$($src.BaseName).db.enc"
        $tmp = Join-Path $daily "$name.partial"; $partials.Add($tmp)
        [IO.File]::WriteAllBytes($tmp, $enc)
        Publish-File $tmp (Join-Path $daily $name)

        # Weekly: when the newest weekly copy is 7 or more days old (or there's none)
        $lastWeekly = Get-ChildItem $weekly -Filter '*.db.enc' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $weeklyNote = ''
        if (-not $lastWeekly -or ((Get-Date) - $lastWeekly.LastWriteTime).TotalDays -ge 7) {
            $wtmp = Join-Path $weekly "$name.partial"; $partials.Add($wtmp)
            Copy-Item (Join-Path $daily $name) $wtmp -Force
            Publish-File $wtmp (Join-Path $weekly $name)
            $weeklyNote = ', weekly copy'
        }
        foreach ($set in @(@($daily, $KeepDaily), @($weekly, $KeepWeekly))) {
            Get-ChildItem $set[0] -Filter '*.db.enc' -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip $set[1] | Remove-Item -Force
        }
        $counts = '{0} daily, {1} weekly kept' -f @(Get-ChildItem $daily -Filter '*.db.enc').Count, @(Get-ChildItem $weekly -Filter '*.db.enc').Count
        Write-Log ("  {0}: {1} -> {2} ({3:N0} KB, encrypted and verified{4}; {5})" -f $product, $src.Name, $name, ($enc.Length / 1KB), $weeklyNote, $counts)
        $done++
    }
} catch {
    # Anything unexpected (unreadable source, OneDrive folder not writable, ...) still alerts
    foreach ($p in $partials) { Remove-Item $p -Force -ErrorAction SilentlyContinue }
    Fail "unexpected error: $($_.Exception.Message)"
}
Write-Log "OK: $done product(s) copied"
exit 0   # explicit, so the scheduled task records success (result 0)
