# DeskSOS Enterprise - Development Environment Teardown Script
# File: stop-dev.ps1
#
# Reverses everything start-dev.ps1 launches so the next startup is clean:
#   - PM2 backend process (desksos-enterprise-backend)
#   - Helper windows opened by start-dev.ps1 (PM2 log tail, React client)
#   - Anything still listening on the backend (5100) or client (3000) ports
#   - Orphaned PM2 daemons left behind by failed pm2 calls (these cause the
#     "connect EPERM \\.\pipe\rpc.sock" errors on the next startup)
#
# Docker containers are intentionally NOT touched: the Postgres/Redis the
# backend connects to may be shared with other projects.
#
# Usage:
#   .\stop-dev.ps1              # normal teardown
#   .\stop-dev.ps1 -DryRun      # show what would be stopped, change nothing
#   .\stop-dev.ps1 -Backup      # run backup-desksos.ps1 first
#   .\stop-dev.ps1 -KillPm2     # stop ALL PM2 daemons and apps they manage (full PM2 reset)
#   .\stop-dev.ps1 -ClearCache  # also clear the React dev server cache
#   .\stop-dev.ps1 -Force       # kill port holders even if they don't look like DeskSOS

param(
    [switch]$DryRun,
    [switch]$Backup,
    [switch]$KillPm2,
    [switch]$ClearCache,
    [switch]$Force
)

$ProjectRoot = $PSScriptRoot
$Ports = @(5100, 3000)
$Pm2Name = "desksos-enterprise-backend"
# Command-line fragments that identify processes belonging to this project
$OwnedPatterns = @(
    [regex]::Escape($ProjectRoot),
    "react-scripts",
    "backend\\server\\dist",
    "ProcessContainerFork",
    "pm2 logs $Pm2Name",
    "cd client; npm start"
)

function Test-Owned([string]$CommandLine) {
    if (-not $CommandLine) { return $false }
    foreach ($p in $OwnedPatterns) { if ($CommandLine -match $p) { return $true } }
    return $false
}

function Stop-Tree([int]$ProcessId, [string]$Label) {
    if ($DryRun) {
        Write-Host "  [dry-run] Would stop $Label (PID $ProcessId)" -ForegroundColor DarkGray
        return
    }
    # /T kills child processes too (npm -> node -> react-scripts)
    taskkill /PID $ProcessId /T /F 2>&1 | Out-Null
    Write-Host "  -> Stopped $Label (PID $ProcessId)" -ForegroundColor Green
}

$pm2Available = [bool](Get-Command pm2 -ErrorAction SilentlyContinue)

# Any pm2 CLI call spawns a new daemon if it can't reach a healthy one. When
# several daemons fight over \\.\pipe\rpc.sock every call fails with EPERM and
# leaves yet another orphan behind, so only use the CLI when exactly one
# daemon exists and it matches the pid file.
$pm2Home = if ($env:PM2_HOME) { $env:PM2_HOME } else { Join-Path $env:USERPROFILE ".pm2" }
$pidFile = Join-Path $pm2Home "pm2.pid"
$pidFileDaemon = if (Test-Path $pidFile) { [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1) } else { 0 }

function Get-Pm2Daemons {
    @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match "pm2\\lib\\Daemon\.js" })
}
function Get-ChildCount([int]$ProcessId) {
    @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue).Count
}

$pm2Daemons = Get-Pm2Daemons
$pm2Running = $pm2Available -and $pm2Daemons.Count -ge 1
$pm2Healthy = $pm2Daemons.Count -eq 1 -and $pm2Daemons[0].ProcessId -eq $pidFileDaemon
# If PM2's pipe exists but no daemon is visible, it belongs to a daemon started
# from an elevated ("Run as administrator") shell. A non-elevated client gets
# EPERM connecting to it, so this script must be run elevated as well.
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
$pm2PipeExists = Test-Path "\\.\pipe\rpc.sock"
$pm2ElevatedDaemon = $pm2PipeExists -and $pm2Daemons.Count -eq 0 -and -not $isElevated

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "   DeskSOS Enterprise Development Teardown       " -ForegroundColor Cyan
if ($DryRun) {
Write-Host "   (dry run - nothing will be changed)           " -ForegroundColor Cyan
}
Write-Host "=================================================" -ForegroundColor Cyan

# Step 1: Optional safety backup
Write-Host "`n[1/6] Safety backup..." -ForegroundColor Yellow
$backupScript = Join-Path $ProjectRoot "backup-desksos.ps1"
if (-not $Backup) {
    Write-Host "  -> Skipped (pass -Backup to enable)" -ForegroundColor Gray
}
elseif (-not (Test-Path $backupScript)) {
    Write-Host "  -> backup-desksos.ps1 not found, skipping" -ForegroundColor Gray
}
elseif ($DryRun) {
    Write-Host "  [dry-run] Would run $backupScript" -ForegroundColor DarkGray
}
else {
    & $backupScript
}

# Step 2: Stop the PM2-managed backend
Write-Host "`n[2/6] Stopping PM2 backend service..." -ForegroundColor Yellow
if (-not $pm2Available) {
    Write-Host "  -> PM2 not installed, skipping" -ForegroundColor Gray
}
elseif ($pm2ElevatedDaemon) {
    Write-Host "  -> PM2 daemon is running elevated and can't be reached from this shell" -ForegroundColor DarkYellow
    Write-Host "     Re-run stop-dev.ps1 from an elevated terminal to stop '$Pm2Name' under PM2." -ForegroundColor DarkYellow
}
elseif (-not $pm2Running) {
    Write-Host "  -> PM2 daemon is not running, nothing to stop" -ForegroundColor Gray
}
elseif (-not $pm2Healthy) {
    Write-Host "  -> PM2 is in a broken state ($($pm2Daemons.Count) daemons running), skipping PM2 CLI" -ForegroundColor DarkYellow
    Write-Host "     The backend is still stopped via its port in step 4. Use -KillPm2 to reset PM2." -ForegroundColor DarkYellow
}
else {
    pm2 describe $Pm2Name 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  -> '$Pm2Name' is not registered with PM2 (or the daemon is unreachable)" -ForegroundColor Gray
    }
    elseif ($DryRun) {
        Write-Host "  [dry-run] Would stop and delete PM2 process '$Pm2Name'" -ForegroundColor DarkGray
    }
    else {
        pm2 stop $Pm2Name 2>&1 | Out-Null
        pm2 delete $Pm2Name 2>&1 | Out-Null
        pm2 save --force 2>&1 | Out-Null
        Write-Host "  -> Removed '$Pm2Name' from PM2" -ForegroundColor Green
    }
}

# Step 3: Close helper windows opened by start-dev.ps1
Write-Host "`n[3/6] Closing log monitor and client windows..." -ForegroundColor Yellow
$helperWindows = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
    Where-Object {
        $_.ProcessId -ne $PID -and
        ($_.CommandLine -match "pm2 logs $Pm2Name" -or $_.CommandLine -match "cd client; npm start")
    }
if ($helperWindows) {
    foreach ($w in $helperWindows) {
        $label = if ($w.CommandLine -match "pm2 logs") { "PM2 log window" } else { "React client window" }
        Stop-Tree $w.ProcessId $label
    }
}
else {
    Write-Host "  -> No helper windows found" -ForegroundColor Gray
}

# Step 4: Release ports
Write-Host "`n[4/6] Releasing ports $($Ports -join ', ')..." -ForegroundColor Yellow
foreach ($port in $Ports) {
    $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    if (-not $pids) {
        Write-Host "  -> Port $port is free" -ForegroundColor Green
        continue
    }
    foreach ($procId in $pids) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        $cmd = if ($proc) { $proc.CommandLine } else { "" }
        if ($Force -or (Test-Owned $cmd)) {
            Stop-Tree $procId "port $port holder"
        }
        elseif (-not $cmd) {
            Write-Host "  -> Port $port is held by PID $procId, which this shell can't inspect (likely elevated)." -ForegroundColor Red
            Write-Host "     Left running. Re-run from an elevated terminal, or use -Force." -ForegroundColor Red
        }
        else {
            Write-Host "  -> Port $port is held by a non-DeskSOS process (PID $procId): $cmd" -ForegroundColor Red
            Write-Host "     Left running. Re-run with -Force to kill it anyway." -ForegroundColor Red
        }
    }
}

# Step 5: PM2 daemon cleanup and optional cache cleanup
Write-Host "`n[5/6] PM2 daemon and cache cleanup..." -ForegroundColor Yellow
$pm2Daemons = Get-Pm2Daemons
if ($KillPm2) {
    # Kill daemons directly rather than via 'pm2 kill', which can itself spawn
    # a new daemon when the pipe is contended. /T also stops managed apps.
    if ($pm2Daemons.Count -eq 0) {
        Write-Host "  -> No PM2 daemons running" -ForegroundColor Gray
    }
    else {
        Write-Host "  -> Stopping all $($pm2Daemons.Count) PM2 daemon(s) and any apps they manage" -ForegroundColor DarkYellow
        foreach ($d in $pm2Daemons) { Stop-Tree $d.ProcessId "PM2 daemon" }
        if (-not $DryRun -and (Test-Path $pidFile)) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
    }
}
else {
    # Always sweep orphans: daemons that aren't the pid-file daemon and manage
    # no processes are leftovers from failed pm2 calls.
    $orphans = @($pm2Daemons | Where-Object {
        $_.ProcessId -ne $pidFileDaemon -and (Get-ChildCount $_.ProcessId) -eq 0
    })
    if ($orphans.Count -gt 0) {
        Write-Host "  -> Found $($orphans.Count) orphaned PM2 daemon(s)" -ForegroundColor DarkYellow
        foreach ($o in $orphans) { Stop-Tree $o.ProcessId "orphaned PM2 daemon" }
    }
    else {
        Write-Host "  -> No orphaned PM2 daemons" -ForegroundColor Gray
    }
}
$cacheDir = Join-Path $ProjectRoot "client\node_modules\.cache"
if ($ClearCache -and (Test-Path $cacheDir)) {
    if ($DryRun) {
        Write-Host "  [dry-run] Would delete $cacheDir" -ForegroundColor DarkGray
    }
    else {
        Remove-Item $cacheDir -Recurse -Force
        Write-Host "  -> Cleared React dev server cache" -ForegroundColor Green
    }
}

# Step 6: Verify the environment is actually clean
Write-Host "`n[6/6] Verifying teardown..." -ForegroundColor Yellow
if (-not $DryRun) { Start-Sleep -Seconds 1 }
$stillBusy = @()
foreach ($port in $Ports) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        $stillBusy += $port
    }
}
$remainingDaemons = (Get-Pm2Daemons).Count
if (-not $DryRun) {
    Write-Host "  -> PM2 daemons remaining: $remainingDaemons" -ForegroundColor Gray
}

Write-Host ""
if ($DryRun) {
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "Dry run complete. Re-run without -DryRun to apply." -ForegroundColor Cyan
    Write-Host "=================================================" -ForegroundColor Cyan
    exit 0
}
if ($stillBusy.Count -gt 0) {
    Write-Host "=================================================" -ForegroundColor Red
    Write-Host "Teardown incomplete: port(s) $($stillBusy -join ', ') still in use." -ForegroundColor Red
    Write-Host "=================================================" -ForegroundColor Red
    exit 1
}
Write-Host "=================================================" -ForegroundColor Green
Write-Host "Teardown complete. Run .\start-dev.ps1 to relaunch." -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
exit 0
