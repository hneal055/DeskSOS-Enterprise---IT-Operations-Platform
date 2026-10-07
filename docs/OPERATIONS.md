# DeskSOS Enterprise: operations runbook and administrator guide

This is for whoever runs DeskSOS Enterprise on **FORD-DC01**. It covers daily checks, start and stop, upgrades and rollback, backup and restore, accounts, secrets, certificates and troubleshooting. You don't need to have built the system to follow it.

Related documents:

- [README](../README.md): developer setup and configuration reference
- [User guide](USER-GUIDE.md): for operators and viewers. Give this to dashboard users
- [API reference](API_REFERENCE.md)
- [readiness plan](PRODUCTION-READINESS-PLAN.md): history and open tasks
- **DeskSOS Desktop** has its own runbook: `C:\Projects\DESKSOS-Desktop\docs\OPERATIONS.md`

> **Two rules that prevent most problems**
> 1. Run every command here in an **Administrator PowerShell 7** window. The production scripts need PowerShell 7, and PM2 runs elevated. From a Windows PowerShell 5.1 window, run a script through PowerShell 7, for example `& "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File C:\Projects\DESKSOS\start-production.ps1 -SkipBuild`.
> 2. Run commands from `C:\Projects\DESKSOS` unless a step says otherwise.

---

## 1. At a glance

| | Production | Development |
|---|---|---|
| Address | **https://FORD-DC01:5543** (dashboard and API) | http://localhost:3000 (dashboard), :5100 (API) |
| PM2 process | `desksos-enterprise` | `desksos-enterprise-backend` |
| Database | `backend\server\data\enterprise-prod.db` | `backend\server\data\enterprise.db` |
| Secrets | `backend\server\.env.production` | `backend\server\.env` |
| Admin sign-in | `admin@desksos.local` (own password) | Separate account in the dev database |
| Started by | `start-production.ps1`; boot task | `start-dev.ps1` |

**Scheduled tasks** (registered by `register-production-tasks.ps1`; they run whether or not anyone is signed in):

| Task | When | Does | Log |
|---|---|---|---|
| DeskSOS Enterprise Startup | Boot + 3 min | `start-production.ps1 -SkipBuild` | `backend\server\logs\startup.log` |
| DeskSOS Enterprise Daily Backup | 02:30 | Verified backup to `backups\production` (14 kept) | `backend\server\logs\backup.log` |
| DeskSOS Enterprise Health Monitor | Every 5 min | Checks `/health` and the certificate, alerts on change, restarts Enterprise if it stays down (§3.1) | `backend\server\logs\monitor.log` |

**Firewall:** the rule "DeskSOS Enterprise (HTTPS 5543, LAN only)" allows TCP 5543 from the local subnet only.

**Other things that live on this PC:**

- **DeskSOS Desktop:** PM2 `desksos-backend`, port 5443. It forwards tickets here.
- **The mkcert certificate authority**, used for HTTPS.
- **The PC must not sleep.** Sleep on AC power is off: see §9.

---

## 2. Daily and weekly checks

**Daily** (2 minutes):

```powershell
pm2 status                                                    # desksos-enterprise: online
Invoke-RestMethod https://FORD-DC01:5543/health               # status ok, database connected
Get-Content backend\server\logs\monitor.log -Tail 5           # any DOWN / Recovered lines
Get-Content backend\server\logs\backup.log -Tail 3            # last night's backup: "Verified: integrity ok"
```

**Weekly:**

```powershell
Get-ScheduledTask "DeskSOS Enterprise *" | Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult
```

Backup and Health Monitor should show `LastTaskResult` **0**. Startup shows its result from the last boot.

Also check that `backups\production` has a file from each recent night.

**Quarterly:** do a restore drill (§5.3) and record the result in the plan.

---

## 3. Start, stop, restart

> **Why the startup task matters.** On Windows, the PM2 daemon belongs to the console window that first started it. If that window closes, **every production app stops with it**. That happened on 2026-10-06: both products were down for about 30 minutes. Starting through the scheduled task runs PM2 with no window attached, so it can't happen that way. Prefer it whenever PM2 isn't already running from a task, for example after `pm2 kill`.

| Action | Command |
|---|---|
| Start or restart (preferred: no window involved) | `Start-ScheduledTask "DeskSOS Enterprise Startup"` |
| Start or restart, watching the output | `.\start-production.ps1 -SkipBuild` |
| Rebuild and restart (after code changes) | `.\start-production.ps1` |
| Stop on purpose | Enter maintenance mode first (§3.1), then `pm2 stop desksos-enterprise` |
| Start a stopped instance | `pm2 start desksos-enterprise` |
| Live logs | `pm2 logs desksos-enterprise` |

`start-production.ps1` is safe to run again. Each run:

1. checks PM2
2. creates `.env.production` with new secrets **only if it's missing**
3. creates or checks the certificate
4. builds, reinstalling packages when `package-lock.json` changed
5. replaces the running instance
6. waits for `/health`

A restart signs nobody out, because tokens survive restarts. Open dashboards reconnect by themselves.

**Note:** the health monitor will log DOWN and then Recovered around a restart. That's expected.

### 3.1 Self-healing and maintenance mode

The Health Monitor restarts Enterprise by itself if it stays down:

| When | What happens |
|---|---|
| 1st failed check | A DOWN alert is sent. Nothing is restarted yet, because brief restarts are normal |
| 2nd failed check in a row (5–10 minutes) | It runs `DeskSOS Enterprise Startup` and alerts "Restarting automatically". It never starts the task while it's already running |
| Back up | A Recovered alert is sent |
| 3 restarts within an hour, still down | "Self-healing gave up" (sent once). Someone has to look: `pm2 logs desksos-enterprise`, `backend\server\logs\startup.log` |

**Stopping it on purpose (upgrades, a restore, investigating):** create the maintenance file **first**, or the monitor restarts Enterprise within about 10 minutes:

```powershell
New-Item C:\Projects\DESKSOS\backend\server\logs\MAINTENANCE -Force   # pause self-healing
pm2 stop desksos-enterprise
# ... work ...
Start-ScheduledTask "DeskSOS Enterprise Startup"
Remove-Item C:\Projects\DESKSOS\backend\server\logs\MAINTENANCE        # resume self-healing
```

In maintenance mode, DOWN alerts still go out and say "Maintenance mode". **Remember to remove the file**, or a real outage won't be fixed automatically.

---

## 4. Upgrade and rollback

### Upgrade

```powershell
cd C:\Projects\DESKSOS
git switch main
git pull
.\start-production.ps1          # build and restart; reinstalls packages if they changed
Invoke-RestMethod https://FORD-DC01:5543/health
```

Then sign in to the dashboard and open an incident to confirm it works. Before a large upgrade, take a backup first (§5.1).

### Rollback

1. Find the last good version: `git log --oneline -10`. Merge commits are the releases.
2. Switch to it and restart:
   ```powershell
   git switch --detach <commit>
   .\start-production.ps1
   ```
3. If the bad version changed data, also restore the last backup from before the upgrade (§5.2).
4. Afterwards, go back with `git switch main` once a fixed version is merged.

---

## 5. Backup and restore

### 5.1 Backups

The nightly task backs up production automatically. To take one now (for example before an upgrade):

```powershell
pwsh backend\server\scripts\backup-prod.ps1
```

Each backup is one self-contained `.db` file in `backups\production`, checked with `integrity_check`. The newest 14 are kept.

- **Not included:** the secrets file `backend\server\.env.production`. Keep a copy of its values in a password manager.
- **Off-machine copy:** until task 3.2 is done, the backups sit on the same disk as the database. A disk failure would lose both.

### 5.2 Restore production from a backup

This replaces the live database. Everything since that backup is lost.

```powershell
cd C:\Projects\DESKSOS
New-Item backend\server\logs\MAINTENANCE -Force    # pause self-healing during the restore
pm2 stop desksos-enterprise

# 1. Keep the current database, in case you need it back
$keep = "backups\pre-restore-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory $keep | Out-Null
Copy-Item backend\server\data\enterprise-prod.db* $keep

# 2. Put the backup in place. The -wal/-shm files belong to the old database: remove them
Remove-Item backend\server\data\enterprise-prod.db-wal, backend\server\data\enterprise-prod.db-shm -ErrorAction SilentlyContinue
Copy-Item backups\production\<chosen-backup>.db backend\server\data\enterprise-prod.db -Force

# 3. Start, check, resume self-healing
Start-ScheduledTask "DeskSOS Enterprise Startup"
Start-Sleep 30; Invoke-RestMethod https://FORD-DC01:5543/health
Remove-Item backend\server\logs\MAINTENANCE
```

Then sign in and check that the incidents look right.

- **Sign-in after a restore:** accounts and passwords are as they were at the time of the backup.
- **Desktop tickets:** tickets that Desktop forwarded after the backup aren't sent again, because Desktop already marked them delivered.

### 5.3 Restore drill (quarterly)

This proves that a backup really restores, without touching production:

```powershell
pwsh backend\server\scripts\restore-drill.ps1                 # newest production backup
pwsh backend\server\scripts\restore-drill.ps1 -Backup <file>  # a specific one
```

The drill:

1. copies the backup to a temporary folder
2. checks its integrity and counts the incidents, users and history events
3. starts a throwaway server on port 5199 against the copy, and checks it's healthy, enforces sign-in, and returns the backup's incidents to a signed-in request (using a short-lived token valid only for that throwaway server)
4. cleans up

The result is appended to `backend\server\logs\restore-drill.log`, ending in `PASS` or `FAIL`. Record the date and result in the plan's progress log.

---

## 6. Accounts (administrator guide)

Roles:

| Role | Can |
|---|---|
| **admin** | Everything, including managing users |
| **operator** | Create incidents, change their status and lock them |
| **viewer** | Read only. Suits wall screens and managers |

### 6.1 Add a user (onboarding)

1. In the dashboard, open **Users** in the header and use **Add user**: name, email, role.
2. A **temporary password** appears once. Click **Copy**.
3. Give it to the person **in person, by phone or by text**. Don't email it or put it in a screenshot or ticket. **Enterprise doesn't send email.**
4. Make sure their PC trusts the DeskSOS certificate (§8.2). Otherwise their browser shows a warning.
5. They open `https://FORD-DC01:5543`, sign in, and must choose their own password (12+ characters) straight away. Their status changes from "Password change pending" to **Active**.

### 6.2 Change a role

Pick the new role in the user's row. The change is immediate: their current sessions end and they sign in again with the new role.

### 6.3 Someone leaves (offboarding)

Click **Deactivate** in their row. Their sessions end immediately, including any open dashboard. Their history stays, and users are never deleted. To restore access, reactivate them.

### 6.4 Forgotten password

Click **Reset password** in their row and hand over the new temporary password as in §6.1. You can't reset your own password this way: use **Change password** in the header.

### 6.5 Every admin is locked out

On the server:

```powershell
cd C:\Projects\DESKSOS\backend\server
$env:DATABASE_PATH = 'data\enterprise-prod.db'
npm run user:reset-password -- --list
npm run user:reset-password -- admin@desksos.local
Remove-Item Env:DATABASE_PATH
```

This prints a temporary password once, reactivates the account if needed and ends its sessions. Sign in and set your own.

### 6.6 Audit trail

Sign-ins, failed sign-ins, password changes, user changes and resets are logged as `"type":"audit"`:

```powershell
Select-String backend\server\logs\pm2-out*.log -Pattern '"type":"audit"' | Select-Object -Last 20
```

Each incident's own history (created, ingested, status changes, locks) is in the dashboard's inspection console. It's also available from `GET /api/incidents/:id/history`.

**The one exception to "secrets are never logged":** the very first start of a new database prints the initial admin password to the PM2 log, so it can be read once. It stops working as soon as it's changed at first sign-in.

---

## 7. Secrets and keys

| Secret | Where | Rotate when |
|---|---|---|
| `JWT_SECRET` | `backend\server\.env.production` | It may have been exposed, or someone with server access leaves |
| `INGEST_API_KEY` (shared with Desktop) | Here and in Desktop's `backend\.env.production` | It may have been exposed |
| mkcert CA private key | `rootCA-key.pem` in `mkcert -CAROOT` | Never leaves this PC. If it's copied anywhere, replace the CA and re-trust it on every PC |

### 7.1 Rotate the JWT secret (signs everyone out)

```powershell
$f = 'C:\Projects\DESKSOS\backend\server\.env.production'
$bytes = [byte[]]::new(48); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$new = 'JWT_SECRET=' + [Convert]::ToBase64String($bytes)
$lines = @(Get-Content $f | Where-Object { $_ -notmatch '^\s*JWT_SECRET\s*=' }) + $new
Set-Content $f $lines -Encoding utf8NoBOM
'JWT_SECRET rotated (not shown).'
.\start-production.ps1 -SkipBuild
```

Everyone signs in again. Passwords aren't affected.

### 7.2 Rotate the Desktop ingest key

```powershell
.\rotate-ingest-key.ps1 -Production
.\start-production.ps1 -SkipBuild
& "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File C:\Projects\DESKSOS-Desktop\backend\scripts\start-production.ps1 -SkipBuild
```

The script writes the same new key to both secrets files and never prints it. Tickets created while only one side has restarted wait in Desktop's queue and arrive afterwards.

---

## 8. HTTPS certificate

### 8.1 Renewal

The current certificate covers `localhost`, `127.0.0.1`, `FORD-DC01` and `192.168.12.196`, and expires on **2029-01-05**. The health monitor warns daily from 14 days before expiry.

To renew it, or to add a name or address:

```powershell
pwsh backend\server\scripts\gen-cert.ps1
.\start-production.ps1 -SkipBuild
```

Other PCs keep working without any change, because they trust the authority, not the certificate.

### 8.2 Trust the authority on another PC (once per PC)

Copy `backend\server\certs\desksos-ca.crt` (the **public** certificate) to the PC. Then, in an Administrator window on that PC:

```powershell
Import-Certificate -FilePath .\desksos-ca.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Check by opening `https://FORD-DC01:5543` in Edge or Chrome on that PC: there should be no warning.

- **Firefox** also needs `security.enterprise_roots.enabled = true` in `about:config`.
- **Never copy `rootCA-key.pem`.**

---

## 9. Server PC settings

These were set once. Check them after Windows feature updates or if something changes.

| Setting | Check | Fix |
|---|---|---|
| **No sleep on AC power** (the PC slept overnight on 2026-10-05) | `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` → AC index `0x0` | `powercfg /change standby-timeout-ac 0`; `powercfg /change hibernate-timeout-ac 0` |
| **Node.js firewall rules limited to the LAN.** Windows' "Allow" prompt creates rules that open every Node port to any address | `Get-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' \| Get-NetFirewallAddressFilter` → `LocalSubnet` | `Get-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' \| Set-NetFirewallRule -EdgeTraversalPolicy Block -RemoteAddress LocalSubnet` |
| **Production firewall rule** | `Get-NetFirewallRule -DisplayName 'DeskSOS Enterprise*'` | `.\register-production-tasks.ps1` |
| **Wi-Fi network profile is Private** | `Get-NetConnectionProfile` | Settings → Network → Wi-Fi → Private |

If Windows ever shows "Node.js wants to access the network" again (for example after a Node update), choosing Allow creates a new unrestricted rule. Limit it with the fix above.

---

## 10. Alerts

The Health Monitor writes DOWN and Recovered to `monitor.log`. To also send them out, set user-level environment variables for the Administrator account and then run `.\register-production-tasks.ps1` again:

| Channel | Variables |
|---|---|
| **Discord** (in use since 2026-10-07) | `ALERT_DISCORD_WEBHOOK_URL`: a channel webhook (Edit Channel → Integrations → Webhooks) |
| Teams (decision D6) | `ALERT_TEAMS_WEBHOOK_URL`. Needs Teams for work or school, because Teams (free) has no webhooks |
| Email | `ALERT_SMTP_HOST`, `ALERT_SMTP_PORT`, `ALERT_SMTP_USER`, `ALERT_SMTP_PASS`, `ALERT_TO` |

**Error tracking (Sentry, optional).** Put the project's DSN in `.env.production` as `SENTRY_DSN=...`, restart with `.\start-production.ps1 -SkipBuild`, then check it from `backend\server`:

```powershell
$env:NODE_ENV = 'production'; npm run sentry:test; Remove-Item Env:NODE_ENV
```

It should say `Sent test error ...`, and the error should appear in the Sentry project. Server errors (5xx) are then reported automatically. Passwords, tokens, API keys and request bodies are never sent.

**Status (2026-10-06):** email is set up but Gmail rejects the sign-in, and Teams isn't configured. **Until one works, nobody is notified of an outage.** See the plan entry "Email alerts: deferred".

**Pasting a secret into a prompt:** hidden prompts in the VS Code terminal don't accept pastes. Use a pop-up box instead:

```powershell
$c = Get-Credential -UserName 'unused' -Message 'Paste the secret'
[Environment]::SetEnvironmentVariable('ALERT_SMTP_PASS', $c.GetNetworkCredential().Password, 'User')
Remove-Variable c
```

---

## 11. Remove production

```powershell
.\register-production-tasks.ps1 -Unregister     # tasks and firewall rule
pm2 delete desksos-enterprise
pm2 save
```

The database, backups, certificates and secrets stay on disk until you delete them.

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A script says it requires PowerShell 7.0 | The window is Windows PowerShell 5.1 | Use PowerShell 7, or run the script through `pwsh.exe` (see the top of this page) |
| `.\start-production.ps1` is "not recognized" | Wrong folder, or the update isn't pulled | `cd C:\Projects\DESKSOS`; `git pull` |
| `connect EPERM \\.\pipe\rpc.sock` | PM2 runs elevated and the window isn't | Use an Administrator window |
| Build fails: `'vite' is not recognized` | Packages are out of date (fixed in the script since 2026-10-06) | `cd client; npm ci; cd ..`, then `.\start-production.ps1` |
| Dashboard unreachable overnight or after idle | The PC went to sleep | §9: disable sleep on AC power |
| Enterprise comes back by itself after you stopped it | Self-healing restarted it (§3.1) | Create `backend\server\logs\MAINTENANCE` before stopping it on purpose |
| "Self-healing gave up" alert | Restarting 3 times in an hour didn't help | `pm2 logs desksos-enterprise`, `backend\server\logs\startup.log`; fix, then `Start-ScheduledTask "DeskSOS Enterprise Startup"` |
| Nothing is running after a reboot | The startup task failed | `Get-Content backend\server\logs\startup.log -Tail 30`; `Get-ScheduledTaskInfo "DeskSOS Enterprise Startup"` |
| Certificate warning on another PC | The authority isn't trusted there | §8.2 |
| Page doesn't load from another PC | Firewall, the Wi-Fi profile is Public, or the PC isn't on the LAN | §9; check `Test-NetConnection FORD-DC01 -Port 5543` from that PC |
| "Invalid email or password" for the admin | Using the dev password, or `.com` instead of `.local` | Production is `admin@desksos.local`; §6.5 if it's lost |
| "Too many failed sign-in attempts" | 10 failures for that email from that PC within 15 minutes | Wait 15 minutes |
| Desktop tickets don't arrive | The dev Desktop app is in use, the ingest key isn't paired, or Enterprise is stopped | Use the release Desktop app; §7.2; check `pm2 logs desksos-enterprise` for `POST /api/ingest/incidents` |
| A Critical ticket arrives but there's no sound | Audio isn't armed (it resets on every page reload) | Click **🔇 Click to Arm Audio** in the header after each reload; it changes to **🔊 Tactical Audio: Armed**. See the [user guide](USER-GUIDE.md) §4 |
| `curl.exe` gives an SSL error with a trusted certificate | Windows curl checks revocation, and the local CA has none | Add `--ssl-no-revoke`, or use `Invoke-RestMethod` |
| The server refuses to start: `JWT_SECRET` | The secret is missing, weak, or a placeholder | Check `.env.production`. Remove any Windows user variable named `JWT_SECRET` |
| An email alert failed | Wrong SMTP settings or credentials | `monitor.log` shows the reason; §10 |
