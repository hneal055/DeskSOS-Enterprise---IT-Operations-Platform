#Requires -Version 7
<#
.SYNOPSIS
    DeskSOS Enterprise uptime monitor: checks /health and alerts when it goes
    down or recovers.

.DESCRIPTION
    Runs every 5 minutes from Task Scheduler (register-production-tasks.ps1).
    Alerts fire only on a state change (up -> down, down -> up), so an outage
    produces one alert, not one every five minutes. A failed alert is retried
    on the next run. For https URLs it also warns once a day when the TLS
    certificate expires within 14 days.

    The certificate is validated normally, so an untrusted or wrong
    certificate counts as down: browsers would reject it too.

    Alert channels (set as user-level environment variables for the account
    the task runs as; without any, alerts are only written to the log):
      Discord:              ALERT_DISCORD_WEBHOOK_URL channel webhook URL
      Teams (decision D6):  ALERT_TEAMS_WEBHOOK_URL   incoming-webhook / Workflows URL
                            (Teams for work or school; Teams free has no webhooks)
      Email:                ALERT_SMTP_HOST, ALERT_SMTP_PORT (587), ALERT_SMTP_USER,
                            ALERT_SMTP_PASS, ALERT_TO

    Log: backend/server/logs/monitor.log   State: logs/monitor-state.json

.EXAMPLE
    pwsh backend/server/scripts/monitor-health.ps1 -Url https://localhost:5543/health
#>
param(
    [string]$Url = ($env:DESKSOS_ENTERPRISE_HEALTH_URL ?? "https://localhost:5543/health"),
    [int]$TimeoutSec = 15,
    [int]$CertWarnDays = 14,
    [string]$LogDir = (Join-Path (Resolve-Path "$PSScriptRoot\..").Path "logs"),
    # Self-healing: after this many failed checks in a row, run the startup
    # task (no console window, so PM2 can't die with one). "" turns it off.
    # A file named MAINTENANCE in $LogDir pauses it during deliberate work.
    [string]$RestartTask = "DeskSOS Enterprise Startup",
    [int]$RestartAfterChecks = 2,
    [int]$MaxRestartsPerHour = 3
)

$logFile = Join-Path $LogDir "monitor.log"
$stateFile = Join-Path $LogDir "monitor-state.json"
New-Item -ItemType Directory -Force $LogDir | Out-Null

function Write-Log([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

function Send-Discord([string]$Subject, [string]$Body) {
    # Plain message; mentions are disabled so alert text can never ping @everyone.
    # Discord caps a message at 2000 characters.
    $text = "**[DeskSOS Enterprise] $Subject**`n$Body"
    if ($text.Length -gt 1900) { $text = $text.Substring(0, 1900) + " ..." }
    $msg = @{ username = "DeskSOS"; content = $text; allowed_mentions = @{ parse = @() } }
    Invoke-RestMethod -Uri $env:ALERT_DISCORD_WEBHOOK_URL -Method Post -ContentType "application/json" `
        -Body ($msg | ConvertTo-Json -Depth 5) -TimeoutSec 15 -ErrorAction Stop | Out-Null
}

function Send-Teams([string]$Subject, [string]$Body) {
    # Adaptive Card message: accepted by Teams Workflows webhooks and by the
    # older incoming-webhook connectors
    $card = @{
        type        = "message"
        attachments = @(@{
                contentType = "application/vnd.microsoft.card.adaptive"
                content     = @{
                    '$schema' = "http://adaptivecards.io/schemas/adaptive-card.json"
                    type      = "AdaptiveCard"
                    version   = "1.4"
                    body      = @(
                        @{ type = "TextBlock"; size = "Medium"; weight = "Bolder"; text = "[DeskSOS Enterprise] $Subject"; wrap = $true }
                        @{ type = "TextBlock"; text = $Body; wrap = $true }
                    )
                }
            })
    }
    Invoke-RestMethod -Uri $env:ALERT_TEAMS_WEBHOOK_URL -Method Post -ContentType "application/json" `
        -Body ($card | ConvertTo-Json -Depth 10) -TimeoutSec 15 -ErrorAction Stop | Out-Null
}

function Send-Email([string]$Subject, [string]$Body) {
    $cred = [pscredential]::new($env:ALERT_SMTP_USER, (ConvertTo-SecureString $env:ALERT_SMTP_PASS -AsPlainText -Force))
    Send-MailMessage -SmtpServer $env:ALERT_SMTP_HOST -Port ([int]($env:ALERT_SMTP_PORT ?? 587)) -UseSsl `
        -Credential $cred -From $env:ALERT_SMTP_USER -To $env:ALERT_TO `
        -Subject "[DeskSOS Enterprise] $Subject" -Body $Body -WarningAction SilentlyContinue -ErrorAction Stop
}

# Returns $false only if every configured channel failed, so the caller keeps
# the old state and the alert is retried on the next run. If at least one
# channel delivered it, someone has been told: retrying would only repeat the
# alert on the working channel every run (e.g. Teams fine, email broken).
function Send-Alert([string]$Subject, [string]$Body) {
    Write-Log "ALERT: $Subject"
    $channels = 0; $delivered = 0
    if ($env:ALERT_DISCORD_WEBHOOK_URL) {
        $channels++
        try { Send-Discord $Subject $Body; $delivered++; Write-Log "  Sent to Discord" }
        catch { Write-Log "  Discord failed: $($_.Exception.Message)" }
    }
    if ($env:ALERT_TEAMS_WEBHOOK_URL) {
        $channels++
        try { Send-Teams $Subject $Body; $delivered++; Write-Log "  Sent to Teams" }
        catch { Write-Log "  Teams failed: $($_.Exception.Message)" }
    }
    if ($env:ALERT_SMTP_HOST -and $env:ALERT_TO -and $env:ALERT_SMTP_USER) {
        $channels++
        try { Send-Email $Subject $Body; $delivered++; Write-Log "  Sent by email" }
        catch { Write-Log "  Email failed: $($_.Exception.Message)" }
    }
    if ($channels -eq 0) { Write-Log "  (no alert channel configured; set ALERT_DISCORD_WEBHOOK_URL, ALERT_TEAMS_WEBHOOK_URL or ALERT_SMTP_*)"; return $true }
    if ($delivered -eq 0) { Write-Log "  No channel delivered the alert (will retry next run)"; return $false }
    return $true
}

$state = if (Test-Path $stateFile) { Get-Content $stateFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
$wasUp = $state.up ?? $true

# ── Health check ──────────────────────────────────────────────────────────────
$isUp = $false
$detail = ""
try {
    $res = Invoke-WebRequest $Url -TimeoutSec $TimeoutSec -SkipHttpErrorCheck -ErrorAction Stop
    $isUp = $res.StatusCode -eq 200
    $detail = "HTTP $($res.StatusCode) $($res.Content)"
} catch {
    $detail = $_.Exception.Message
}

$maintenance = Test-Path (Join-Path $LogDir "MAINTENANCE")
$healNote = if (-not $RestartTask) { "" }
    elseif ($maintenance) { "`n`nMaintenance mode (logs\MAINTENANCE exists): it will NOT be restarted automatically." }
    else { "`n`nIf it's still down at the next check, it will be restarted automatically." }

$delivered = $true
if ($isUp -and -not $wasUp) {
    $delivered = Send-Alert "Recovered" "DeskSOS Enterprise at $Url is responding again.`n`n$detail"
} elseif (-not $isUp -and $wasUp) {
    $delivered = Send-Alert "DOWN" "DeskSOS Enterprise at $Url failed its health check.`n`n$detail`n`nOn the server: pm2 status / pm2 logs desksos-enterprise$healNote"
} elseif (-not $isUp) {
    Write-Log "Still down: $detail"
}
if ($delivered) { $state.up = $isUp }

# ── Self-healing (restart a service that stays down) ──────────────────────────
# Restarts through the startup task, never from this process: the task runs
# start-production.ps1 without a console, so PM2 isn't tied to any window.
$state.downCount = if ($isUp) { 0 } else { [int]($state.downCount ?? 0) + 1 }
$now = Get-Date
$recent = @($state.restarts | Where-Object { $_ -and ([datetime]$_) -gt $now.AddHours(-1) })
if ($isUp) {
    $state.gaveUp = $false
} elseif ($RestartTask) {
    if ($maintenance) {
        Write-Log "Maintenance mode (MAINTENANCE file present): not restarting"
    } elseif ($state.downCount -lt $RestartAfterChecks) {
        Write-Log "Self-healing: down for $($state.downCount) check(s); restarts after $RestartAfterChecks"
    } elseif ($recent.Count -ge $MaxRestartsPerHour) {
        if (-not $state.gaveUp) {
            if (Send-Alert "Self-healing gave up" "DeskSOS Enterprise is still down after $($recent.Count) automatic restart(s) in the last hour. It needs a person.`n`nOn the server: pm2 logs desksos-enterprise; backend\server\logs\startup.log") {
                $state.gaveUp = $true
            }
        } else {
            Write-Log "Self-healing: gave up ($($recent.Count) restarts in the last hour)"
        }
    } else {
        $task = Get-ScheduledTask -TaskName $RestartTask -ErrorAction SilentlyContinue
        if (-not $task) {
            Write-Log "Self-healing: task '$RestartTask' not found; not restarting"
        } elseif ($task.State -eq 'Running') {
            Write-Log "Self-healing: '$RestartTask' is already running; waiting"
        } else {
            try {
                Start-ScheduledTask -TaskName $RestartTask -ErrorAction Stop
                $recent += $now.ToString('o')
                Send-Alert "Restarting automatically" "DeskSOS Enterprise has been down for $($state.downCount) checks. Started '$RestartTask' (attempt $($recent.Count) of $MaxRestartsPerHour this hour)." | Out-Null
            } catch {
                Send-Alert "Automatic restart failed" "Couldn't start '$RestartTask': $($_.Exception.Message)" | Out-Null
            }
        }
    }
}
$state.restarts = $recent

# ── TLS certificate expiry (https only, at most one warning per day) ──────────
$uri = [uri]$Url
if ($isUp -and $uri.Scheme -eq "https" -and $state.certWarned -ne (Get-Date -Format "yyyy-MM-dd")) {
    try {
        $tcp = [Net.Sockets.TcpClient]::new($uri.Host, $uri.Port)
        $ssl = [Net.Security.SslStream]::new($tcp.GetStream(), $false, { $true })
        $ssl.AuthenticateAsClient($uri.Host)
        $expires = [Security.Cryptography.X509Certificates.X509Certificate2]::new($ssl.RemoteCertificate).NotAfter
        $ssl.Dispose(); $tcp.Dispose()
        $daysLeft = [int]($expires - (Get-Date)).TotalDays
        if ($daysLeft -le $CertWarnDays) {
            if (Send-Alert "TLS certificate expires in $daysLeft day(s)" "The certificate for $($uri.Host) expires on $expires. Renew it with backend/server/scripts/gen-cert.ps1, then run .\start-production.ps1 -SkipBuild") {
                $state.certWarned = Get-Date -Format "yyyy-MM-dd"
            }
        }
    } catch {
        Write-Log "Certificate check failed: $($_.Exception.Message)"
    }
}

$state | ConvertTo-Json | Set-Content $stateFile
