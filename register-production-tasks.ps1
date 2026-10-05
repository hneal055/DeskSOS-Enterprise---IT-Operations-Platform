#Requires -Version 7
<#
.SYNOPSIS
    Registers DeskSOS Enterprise production's scheduled tasks and firewall rule
    (readiness plan tasks 2.5 and 2.6, plus the daily backup from 3.1).

.DESCRIPTION
      DeskSOS Enterprise Startup       at boot +3 min -> start-production.ps1 -SkipBuild
      DeskSOS Enterprise Daily Backup  daily at 02:30 -> backend\server\scripts\backup-prod.ps1
      DeskSOS Enterprise Health Monitor every 5 minutes -> backend\server\scripts\monitor-health.ps1
      Firewall: "DeskSOS Enterprise (HTTPS 5543, LAN only)" inbound TCP 5543
                from the local subnet only, on every network profile

    Boot +3 minutes: DeskSOS Desktop's startup task runs PM2 at +1 minute; two
    PM2 commands at the same moment can each spawn a daemon (the cause of the
    earlier EPERM / orphaned-daemon problem), so Enterprise waits until Desktop
    has started.

    02:30: offset from Desktop's 02:00 backup.

    Tasks run as the current user whether or not anyone is signed in (S4U,
    highest privileges, like Desktop's) using the MSI install of PowerShell 7;
    the Microsoft Store version can't run in such tasks.

    Run from an Administrator PowerShell 7 window. Running again updates
    everything; -Unregister removes it all.

.EXAMPLE
    .\register-production-tasks.ps1 -DryRun       # show what would be registered (no admin needed)
    .\register-production-tasks.ps1               # register / update
    .\register-production-tasks.ps1 -Unregister   # remove tasks and firewall rule
#>
param(
    [switch]$DryRun,
    [switch]$Unregister,
    [string]$BackupTime = "02:30",
    [int]$Port = 5543
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Server = Join-Path $Root 'backend\server'
$Logs = Join-Path $Server 'logs'
$Prefix = 'DeskSOS Enterprise'
$RuleName = "$Prefix (HTTPS $Port, LAN only)"
$HealthUrl = "https://localhost:$Port/health"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $DryRun -and -not $isAdmin) {
    Write-Host "Run this from an Administrator PowerShell 7 window (or use -DryRun to preview)." -ForegroundColor Red
    exit 1
}

# ── Remove ───────────────────────────────────────────────────────────────────
if ($Unregister) {
    $tasks = @(Get-ScheduledTask -TaskName "$Prefix *" -ErrorAction SilentlyContinue)
    foreach ($t in $tasks) {
        if ($DryRun) { Write-Host "[dry-run] Would remove task: $($t.TaskName)" }
        else { Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false; Write-Host "Removed task: $($t.TaskName)" -ForegroundColor Green }
    }
    if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
        if ($DryRun) { Write-Host "[dry-run] Would remove firewall rule: $RuleName" }
        else { Remove-NetFirewallRule -DisplayName $RuleName; Write-Host "Removed firewall rule: $RuleName" -ForegroundColor Green }
    }
    if (-not $tasks -and -not (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)) { Write-Host "Nothing to remove." }
    exit 0
}

# ── PowerShell for the tasks: the MSI install only ───────────────────────────
$pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
if (-not (Test-Path $pwsh)) {
    Write-Host "The MSI install of PowerShell 7 wasn't found at $pwsh." -ForegroundColor Red
    Write-Host "Scheduled tasks can't start the Microsoft Store version while nobody is signed in (error 0x80070005)." -ForegroundColor Red
    Write-Host "Install it, then run this again:  winget install --id Microsoft.PowerShell --source winget --installer-type wix"
    exit 1
}

foreach ($f in (Join-Path $Root 'start-production.ps1'), (Join-Path $Server 'scripts\backup-prod.ps1'), (Join-Path $Server 'scripts\monitor-health.ps1')) {
    if (-not (Test-Path $f)) { Write-Host "Missing: $f" -ForegroundColor Red; exit 1 }
}

# ── What gets registered ─────────────────────────────────────────────────────
$startCmd = "& '$Root\start-production.ps1' -SkipBuild *>> '$Logs\startup.log'"
$specs = @(
    @{
        Name        = "$Prefix Startup"
        Description = "Starts DeskSOS Enterprise production under PM2 at boot (after DeskSOS Desktop)"
        Arguments   = "-NoProfile -Command `"$startCmd`""
        Trigger     = 'boot'
        Summary     = "at boot +3 min -> start-production.ps1 -SkipBuild (log: backend\server\logs\startup.log)"
    }
    @{
        Name        = "$Prefix Daily Backup"
        Description = "Verified online backup of the DeskSOS Enterprise production database"
        Arguments   = "-NoProfile -File `"$Server\scripts\backup-prod.ps1`""
        Trigger     = 'daily'
        Summary     = "daily at $BackupTime -> backups\production (log: backend\server\logs\backup.log)"
    }
    @{
        Name        = "$Prefix Health Monitor"
        Description = "Checks DeskSOS Enterprise /health every 5 minutes and alerts on outage and recovery"
        Arguments   = "-NoProfile -File `"$Server\scripts\monitor-health.ps1`" -Url `"$HealthUrl`""
        Trigger     = 'every5min'
        Summary     = "every 5 min -> $HealthUrl (log: backend\server\logs\monitor.log)"
    }
)

Write-Host "Tasks will use: $pwsh"
Write-Host "Tasks run as:   $env:USERDOMAIN\$env:USERNAME (whether or not signed in, highest privileges)"

if ($DryRun) {
    foreach ($s in $specs) { Write-Host "[dry-run] Would register: $($s.Name), $($s.Summary)" }
    Write-Host "[dry-run] Would create firewall rule: $RuleName (inbound TCP $Port, remote address LocalSubnet, all profiles)"
    exit 0
}

New-Item -ItemType Directory -Force $Logs | Out-Null
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

foreach ($s in $specs) {
    $trigger = switch ($s.Trigger) {
        'boot' { $t = New-ScheduledTaskTrigger -AtStartup; $t.Delay = 'PT3M'; $t }
        'daily' { New-ScheduledTaskTrigger -Daily -At $BackupTime }
        'every5min' { New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) }
    }
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $s.Arguments -WorkingDirectory $Root
    Register-ScheduledTask -TaskName $s.Name -Description $s.Description -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "Registered: $($s.Name), $($s.Summary)" -ForegroundColor Green
}

# ── Firewall (decision D3: office LAN only) ──────────────────────────────────
# Scoped by address, not network profile: if the network were ever switched to
# Public, a profile-based rule would silently stop applying.
if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName $RuleName }
New-NetFirewallRule -DisplayName $RuleName -Description "DeskSOS Enterprise production dashboard and API (HTTPS), office LAN only" `
    -Direction Inbound -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
Write-Host "Firewall: $RuleName (inbound TCP $Port from the local subnet only)" -ForegroundColor Green

Write-Host ""
Write-Host "Check them now (each should end with LastTaskResult 0):" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask '$Prefix Daily Backup'; Start-ScheduledTask '$Prefix Health Monitor'"
Write-Host "  Start-Sleep 20"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$Prefix Daily Backup' | Select TaskName,LastTaskResult"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$Prefix Health Monitor' | Select TaskName,LastTaskResult"
Write-Host "The startup task is proven by a reboot test."
