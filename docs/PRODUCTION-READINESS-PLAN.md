# DeskSOS Production Readiness Plan

**Scope:** DeskSOS Enterprise (`C:\Projects\DESKSOS`) and DeskSOS Desktop (`C:\Projects\DESKSOS-Desktop`), including the bridge between them
**Prepared:** 2026-10-04, from a hands-on assessment of both projects on FORD-DC01
**Status:** Draft for owner review

---

## 1. Goal

Make both products safe and dependable for three audiences:

| Audience | Who | What "ready" means for them |
|---|---|---|
| **Users** | Help desk analysts and technicians using the Desktop app; operations staff using the Enterprise dashboard | They sign in with their own account, see only what their role allows, and the system is up when they need it |
| **Administrators** | IT staff who run the servers and roll out the Desktop app | Services start on boot, are monitored, are backed up and restorable, and every routine task has a documented procedure |
| **Clients** | The people and machines being supported: end users who raise tickets, and PCs with the Desktop app installed | Their tickets aren't lost, their data is protected, and the app installs and updates without warnings |

## 2. Where things stand

Full findings are in the assessment of 2026-10-04. In short:

- **Desktop** has solid security foundations (sign-in on every route and the socket, HTTPS in production, rate limits, 90 automated tests). But **production is down** and the scheduled backup, health-check and startup tasks **fail with access denied**.
- **Enterprise** works as a prototype, but:
  - **sign-in is a placeholder:** any email and password returns an admin token
  - **the API and live socket need no authentication**
  - it runs on **development servers**
  - its **backups don't contain the incident data**

## 3. Target production setup

Both products run self-hosted on FORD-DC01 under PM2. Each is reachable over HTTPS on its own port and restarts on boot, with monitoring and backups.

| Component | Port | Protocol | Runs as | Database |
|---|---|---|---|---|
| Desktop backend (production) | 5443 | HTTPS + WSS | PM2 `desksos-backend` (`env_production`) | `data/desksos-prod.db` |
| Enterprise backend + dashboard (production) | 5543 *(proposed)* | HTTPS + WSS | PM2 `desksos-enterprise` | `data/enterprise-prod.db` |
| Desktop backend (development) | 5000 | HTTP | `npm run dev` | `data/desksos.db` |
| Enterprise (development) | 5100 + 3000 | HTTP | `start-dev.ps1` | `data/enterprise.db` |

Principles:

- **Development and production stay separate** in their ports, databases, keys and PM2 names, as Desktop already does.
- **The Enterprise backend serves the built dashboard itself.** One HTTPS port, no development server and no CDN in production.
- **Secrets live only in `.env` files** that git ignores, never in backups that git could pick up, and never as defaults in code.
- **One PM2 daemon, always run elevated.** Every operational script refuses to run unelevated (see the earlier EPERM incidents).

## 4. Decisions

**Decided by the owner on 2026-10-05:**

| # | Decision |
|---|---|
| D1 | **Local accounts in Enterprise** (hashed passwords, managed by an Admin). Microsoft Entra ID sign-in may follow after go-live |
| D2 | **Three roles: Admin, Operator, Viewer** |
| D3 | **Office LAN only** (firewall rule scoped to the local network) |
| D4 | **Azure Trusted Signing**, or a public OV certificate if Azure isn't available |
| D5 | **Network share on another PC or NAS** for off-machine backups |
| D6 | **Teams webhook** for alerts |

Each can still be revisited before the phase that depends on it. The options and reasoning considered:

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | How do Enterprise users sign in? | (a) Local accounts in Enterprise, (b) Active Directory / LDAP, (c) Microsoft Entra ID SSO | **(a) now; (c) later if the organization uses Microsoft 365.** Local accounts with roles unblock go-live. FORD-DC01 turned out to be a standalone workgroup PC with no Active Directory (corrected 2026-10-05), so (b) needs a domain that doesn't exist here |
| D2 | Enterprise roles | Admin / Operator / Viewer, or Admin / Operator | **Admin, Operator, Viewer.** Viewer suits wall-screen dashboards and managers |
| D3 | Who can reach Enterprise? | This server only, the office LAN, or the internet | **Office LAN only**, through a firewall rule scoped to the LAN. No internet exposure without a reverse proxy and a further review |
| D4 | Code-signing certificate for the Desktop installer | Public CA (OV/EV, or Azure Trusted Signing), or a self-made certificate trusted manually on each PC | **A public option (Azure Trusted Signing or OV).** Without a domain there's no internal CA or group policy to push trust to client PCs, so a self-made certificate would have to be installed by hand on every PC (corrected 2026-10-05) |
| D5 | Off-machine backup copy | Network share, second disk, or cloud storage | **A network share on another machine.** A backup on the same disk doesn't survive disk failure |
| D6 | Alert channel | Email, Teams webhook, or both | **Teams webhook**, the simplest to wire from the existing health monitor |

---

## 5. Phases

Sizes: **S** is under a day, **M** is 1–3 days, **L** is 3–5 days, all for one developer.
Owner codes: **Dev** for code changes, **Admin** for steps that need an elevated session on FORD-DC01, **Owner** for decisions and reviews.

### Phase 0: Stabilize what exists (days 1–3)

Get production running again and stop silent data loss. No new features.

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 0.1 | Repoint the three Desktop scheduled tasks from the Store `WindowsApps\pwsh.exe` alias to a regular PowerShell 7 install (`C:\Program Files\PowerShell\7\pwsh.exe`). Re-run `register-tasks.ps1` | Admin | S | Each task, run on demand, finishes with result 0 |
| 0.2 | Start Desktop production (`start-production.ps1`) and confirm the health monitor sees it | Admin | S | `https://FORD-DC01:5443/health` returns `ok`; the monitor log shows a pass |
| 0.3 | Fix Enterprise backups: use SQLite's online backup API (like Desktop's `backup-db.js`) instead of copying files, keep N days, and **stop copying `.env` files** | Dev | S | A restored backup contains the current incidents |
| 0.4 | Add `backups/` to Enterprise's `.gitignore`; delete the 22 existing backup folders that contain `.env` copies | Dev, Owner | S | `git status` stays clean; no secrets on disk outside `.env` |
| 0.5 | `npm audit fix` in the Desktop backend (socket.io `engine.io`, `qs`, `morgan`, `uuid`, `ip-address`) | Dev | S | Production audit shows 0; 73/73 tests pass |
| 0.6 | Merge Desktop PR #1, retarget PR #2 to `main` so CI runs on it, then merge | Owner | S | Desktop `main` is current and CI is green |
| 0.7 | Remove or rebuild the broken Enterprise root `docker-compose*.yml` and fix the stale Postgres/Redis references in the docs | Dev | S | No documented command fails |

**Exit gate:** Desktop production is up, a backup of each database has been restored successfully, and no secrets exist outside `.env`.

### Phase 1: Secure Enterprise (week 1–2)

The largest gap. Nothing in Enterprise should be offered to users before this phase is done.

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 1.1 | **Real accounts:** add a `users` table (bcryptjs hashes, role, active flag, created/last-login timestamps). Generate a random first-run admin password, as Desktop does | Dev | M | The placeholder login is gone; a wrong password returns 401 |
| 1.2 | **Require `JWT_SECRET`** of at least 32 characters at startup, with no default. Shorten token lifetime to 8–12 h | Dev | S | The server refuses to start without a strong secret |
| 1.3 | **Authenticate every route** except `/health` and the API-key ingest route. Add role checks: Viewer can only read, Operator can create, update and lock incidents, Admin can manage users | Dev | M | An unauthenticated request to any `/api/*` route returns 401 (tested) |
| 1.4 | **Authenticate the socket.** Require a valid token at handshake, as Desktop does | Dev | S | An unauthenticated socket connection is rejected (tested) |
| 1.5 | **Dashboard sign-in screen**, keeping the token in memory or sessionStorage and signing out on 401 | Dev | M | The dashboard is unusable without signing in |
| 1.6 | **Hardening:** security headers (`helmet`), rate limiting with a stricter limit on login, a request body size limit, and CORS origins from configuration | Dev | S | Security headers are present; login is throttled after N attempts |
| 1.7 | **Input validation** on every write route, using a schema library (zod, as Desktop does) | Dev | S | Invalid payloads return 400 with details (tested) |
| 1.8 | **User management:** admin-only API and a basic screen to add, deactivate and reset users | Dev | M | An admin can onboard and offboard a user without touching the database |
| 1.9 | **Audit trail:** record who created, changed or locked each incident, and when | Dev | S | Incident history shows the user and time for each change |
| 1.10 | Rotate the ingest key and document the rotation procedure for both `.env` files | Dev, Admin | S | The procedure is in the runbook and has been tested once |

**Exit gate:** automated tests prove that no `/api` route or socket event works without a valid token and role, and an independent check finds no open endpoints.

### Phase 2: Production runtime for Enterprise (week 2–3)

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 2.1 | **Move the dashboard from Create React App to Vite**, which Desktop already uses. Replace the Tailwind CDN with a build-time Tailwind setup | Dev | M | Production build succeeds; the client audit drops from 80 findings to near zero |
| 2.2 | **The backend serves the built dashboard** (static files plus a fallback to `index.html`) | Dev | S | One port serves both the API and the UI |
| 2.3 | **HTTPS:** reuse Desktop's `gen-cert.ps1` approach (internal CA, covering the server's names) | Dev, Admin | S | The dashboard loads over HTTPS without warnings on a LAN PC |
| 2.4 | **PM2 production config** (`ecosystem.config.js` with `env_production`: port, database path, TLS paths) and a `start-production.ps1` script with the same elevation and port checks as `start-dev.ps1` | Dev | M | One command starts production; a second run is harmless |
| 2.5 | **Start on boot:** a scheduled task that runs at startup and calls the production script, using the same pattern as Desktop's | Admin | S | After a reboot, Enterprise is up without anyone signing in |
| 2.6 | **Firewall rule** scoped to the office LAN for the production port, per decision D3 | Admin | S | Reachable from a LAN PC; blocked from outside |
| 2.7 | **Structured logging:** winston with JSON output, daily rotation and 14-day retention, plus request logs | Dev | S | Logs rotate; each request shows user, route, status and duration |
| 2.8 | **Point the Desktop production bridge at Enterprise production**, with its own `ENTERPRISE_SOURCE` and key in `env_production` | Dev, Admin | S | A ticket in Desktop production appears in the Enterprise production dashboard |

**Exit gate:** a reboot test passes, so both production services come back on their own, and the dashboard works over HTTPS from a LAN PC.

### Phase 3: Data protection and operations (week 3–4)

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 3.1 | **Scheduled backups for Enterprise production**, using the same task pattern as Desktop | Admin | S | A daily backup file appears and the task result is 0 |
| 3.2 | **Off-machine copy** of both products' backups (decision D5), with retention: 14 daily and 8 weekly | Admin | S | Backups exist on a second machine |
| 3.3 | **Restore drill:** restore each database to a scratch location, start against it, and check the record counts. Repeat quarterly | Admin | S | The drill is documented with its date and result |
| 3.4 | **Health monitoring for Enterprise production**, plus **alerts** for both products (decision D6) | Dev, Admin | S | Stopping a service sends an alert within 5 minutes |
| 3.5 | **Error tracking:** turn on the existing Desktop Sentry hook in production and add the same to Enterprise | Dev | S | A test error appears in Sentry |
| 3.6 | **Bridge visibility:** expose the Desktop outbox status (pending, failed and oldest-pending age) on an admin endpoint, and alert when tickets stay pending for more than an hour | Dev | S | A stuck ticket raises an alert |
| 3.7 | **Enterprise operations runbook**, mirroring Desktop's `OPERATIONS.md`: start, stop, upgrade, back up, restore, rotate secrets, troubleshoot | Dev | M | An admin who wasn't part of the build can follow it end to end |

**Exit gate:** a restore drill succeeds for both databases, and an alert fires for a stopped service and for a stuck bridge queue.

### Phase 4: Quality and release engineering (runs alongside Phases 1–3)

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 4.1 | **Enterprise client tests** with Vitest and Testing Library after 2.1: sign-in, incident list, status change, alerts | Dev | M | Tests run in CI |
| 4.2 | **Bridge end-to-end test** in CI: start both backends with throwaway databases, create a ticket, and assert the incident arrives (based on the existing e2e script) | Dev | M | Runs on every PR in both repos |
| 4.3 | **CI on every PR**, not just PRs into `main`, in both repos | Dev | S | Stacked PRs get CI |
| 4.4 | **Dependabot configuration** (`dependabot.yml`) pointing at the real folders: `backend/server`, `client`, `backend`, `tauri-app` | Dev | S | Dependabot opens PRs only for folders that exist |
| 4.5 | **Versioning and releases:** semantic version tags, a changelog, and a release checklist for each product | Dev, Owner | S | Each release has a tag, notes and a rollback step |
| 4.6 | **Branch protection on `main`:** CI must pass and one review is required | Owner | S | Direct pushes to `main` are blocked |

### Phase 5: Desktop client distribution (week 4–5)

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 5.1 | **Code-sign** the MSI and EXE (decision D4); add signing to the build | Dev, Admin | M | No SmartScreen warning on a clean PC |
| 5.2 | **Auto-updater:** turn on the Tauri updater with a signed update feed hosted internally | Dev | M | An installed app updates itself to a new test version |
| 5.3 | **Clean up the content security policy:** remove the old Railway address and unused ports | Dev | S | The policy lists only the production and development backends |
| 5.4 | **Pilot rollout:** install on 3–5 PCs, collect feedback, then roll out to everyone. There's no domain, so group policy isn't available: use `Manual-Deployment.ps1`, Intune or another device-management tool if one exists | Admin, Owner | M | The pilot runs a week with no blocking issues |

### Phase 6: User readiness and go-live (week 5–6)

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 6.1 | **User guides:** a technician quick-start (Desktop) and an operator and viewer guide (Enterprise dashboard) | Dev, Owner | M | Published where staff can find them |
| 6.2 | **Administrator guide:** accounts and roles, onboarding and offboarding, key rotation, backups and restore, upgrades | Dev | S | Part of the two runbooks |
| 6.3 | **User acceptance testing:** scripted scenarios run by 2–3 real users per product, including a ticket flowing from Desktop to the Enterprise dashboard | Owner | M | All scenarios pass; issues are triaged |
| 6.4 | **Support process:** who users contact, how incidents in DeskSOS itself are handled, response targets | Owner | S | Documented and communicated |
| 6.5 | **Go-live,** using the checklist in section 6 | Owner, Admin | S | Signed off |
| 6.6 | *(Later)* Single sign-on for Enterprise (decision D1-c, Microsoft Entra ID), and syncing Desktop status changes to Enterprise | Dev | L | Separate project after go-live |

---

## 6. Go-live checklist

Every item must be checked for **both** products unless marked otherwise.

**Security**
- [ ] No route or socket event works without authentication, except health and API-key ingest; automated tests prove it
- [ ] No default secrets in code; startup fails if a secret is missing or weak
- [ ] HTTPS with a certificate trusted on client PCs; firewall limited to the LAN
- [ ] Production dependency audit shows 0 high or critical findings
- [ ] Ingest key rotated since development; development and production keys differ

**Reliability**
- [ ] Both services come back after a reboot without anyone signing in (tested)
- [ ] Health monitor and alerts tested by stopping each service
- [ ] Bridge: a ticket created during an Enterprise outage arrives after recovery (tested in production)

**Data**
- [ ] Daily backups running, copied off the machine, and retained per policy
- [ ] Restore drill passed within the last 30 days

**Operations**
- [ ] Runbooks for both products cover start, stop, upgrade, rollback, backup, restore, key rotation and troubleshooting
- [ ] Logs rotate; error tracking receives events

**Users and clients**
- [ ] Accounts created for every launch user, with the right roles; default and first-run passwords changed
- [ ] Desktop installer signed; pilot complete
- [ ] User guides published; support contact communicated
- [ ] User acceptance sign-off recorded

## 7. Timeline at a glance

| Week | Focus | Milestone |
|---|---|---|
| 1 | Phase 0, start Phase 1 | Production stable; backups trustworthy |
| 2 | Phase 1, start Phase 2 | Enterprise requires sign-in end to end |
| 3 | Phase 2, Phase 3 | Enterprise production over HTTPS, starts on boot |
| 4 | Phase 3, Phase 5 | Restore drill passed; alerts live; signed installer |
| 5 | Phase 5 pilot, Phase 6 | Pilot rollout; user acceptance testing |
| 6 | Phase 6 | **Go-live** |

This assumes one developer, with an administrator available for elevated steps, and Phase 4 work running alongside. The critical path is Phase 0 → Phase 1 → Phase 2 → acceptance testing.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Both products and their backups are on one machine, FORD-DC01: a Windows 11 Pro workstation, not a server (corrected 2026-10-05) | Disk loss, Windows updates and restarts, or someone using the PC take everything down. Desktop operating systems aren't built for always-on hosting | Off-machine backups (3.2); set Windows Update active hours and restart policy; in the longer term, host on a dedicated server or VM |
| PM2 elevation mismatch, the cause of the earlier EPERM incidents | Services can't be managed; orphaned daemons build up | All scripts check elevation first (already in place); runbooks state "Administrator window only" |
| The Create React App → Vite move breaks the dashboard | Delays Phase 2 | Do it on a branch with the new client tests (4.1); keep the CRA build until Vite passes UAT |
| Changes to the bridge contract between the repos | Tickets are rejected (400) and marked failed | The bridge end-to-end test (4.2) runs in both repos; failed outbox rows alert (3.6) |
| SQLite limits as usage grows | Write contention | Fine at help desk scale with a single instance. Revisit if several Enterprise instances are ever needed |

## 9. Next actions

1. Owner: review this plan and answer decisions D1–D6.
2. Dev: start Phase 0 tasks 0.3, 0.4, 0.5 and 0.7, which need no decisions.
3. Admin: Phase 0 tasks 0.1 and 0.2 in an Administrator window.

## 10. Progress and verification log

Every completed task gets an entry here, so progress stays tied to the goal in section 1. Each entry records:

- **Change:** what was implemented, and the commit
- **Verification:** the concrete check that was run, and its result
- **Goal impact:** which audience it helps (users, administrators, clients) and which go-live checklist item it moves forward

A task counts as done only once its verification has passed. "Implemented" isn't enough.

| Date | Task | Status |
|---|---|---|
| 2026-10-04 | Plan drafted | ✅ |
| 2026-10-04 | 0.3 Enterprise backups capture real data | ✅ Verified |
| 2026-10-04 | 0.4 No secrets in backups; `backups/` ignored by git | ✅ Verified |
| 2026-10-04 | 0.5 Desktop backend: 0 production vulnerabilities | ✅ Verified |
| 2026-10-04 | 0.7 Broken Docker files removed; docs match reality | ✅ Verified |
| 2026-10-04 | 0.2 Desktop production running | ✅ Verified |
| 2026-10-04 | 0.1 Scheduled backup and health monitor working | ✅ Verified (boot task pending a reboot test) |
| 2026-10-05 | 0.6 Desktop PRs #1 and #2 merged; `main` current and CI green | ✅ Verified |
| 2026-10-05 | 1.2 Strong `JWT_SECRET` required; no fallback | ✅ Verified (on branch `feat/phase1-secure-enterprise`) |
| 2026-10-05 | 1.1 Real accounts replace the "any password works" login | ✅ Verified (on branch) |
| 2026-10-05 | 1.3 Every API route requires sign-in, with role checks | ✅ Verified (on branch) |
| 2026-10-05 | 1.4 Live socket requires sign-in; no identity spoofing | ✅ Verified (on branch) |
| 2026-10-05 | 1.5 Dashboard sign-in, forced password change, read-only viewers | ✅ Verified (on branch) |
| 2026-10-05 | 1.6 Security headers, rate limits, body cap, configurable CORS | ✅ Verified (on branch) |
| 2026-10-05 | 1.7 Input validation on every write route | ✅ Verified (on branch) |

### 0.3 Enterprise backups capture real data

- **Change:** new `backend/server/scripts/backup-db.js` takes an online backup through SQLite's backup API, which includes changes still in the `-wal` file. Each backup is saved as one self-contained file, checked with `PRAGMA integrity_check`, and the oldest beyond 14 are pruned. `backup-desksos.ps1` now calls it and returns its exit code.
- **Verification:**
  - Backup runs and reports "integrity ok, 5 incidents".
  - A restore comparison against the live database matches: 5 incidents, highest ID 5.
  - The backup is a single 24 KB file. The old file copies were 4 KB with **no tables at all**.
  - Pruning removes old backups along with any side files.
  - `stop-dev.ps1 -Backup` still calls the script.
- **Goal impact:** *Administrators* can now restore incident data, which wasn't possible before because every old backup was empty. This is the foundation for go-live items "daily backups running" and "restore drill passed" (Phase 3 adds scheduling and off-machine copies). *Clients'* incident records are protected against data loss.

### 0.4 No secrets in backups; `backups/` ignored by git

- **Change:** `backups/` added to `.gitignore`. The backup script no longer copies `.env` files. The 22 old backup folders were removed after each was checked: they held only `.env` copies and empty database files.
- **Verification:** `git check-ignore` confirms `backups/` is ignored; `backups/` holds 0 `.env` files and only the verified backup; `git status` shows no backup files.
- **Goal impact:** removes the risk of committing secrets to GitHub with `git add -A`, and of keeping 22 stray copies of them on disk. Moves forward go-live item "no secrets outside `.env`" (*administrators*, security).

### 0.5 Desktop backend: 0 production vulnerabilities

- **Change** (Desktop repo, PR #2 branch): `npm audit fix` updated `engine.io` (socket.io, high), `qs`, `morgan` and `ip-address`. The `uuid` package was replaced with Node's built-in `crypto.randomUUID()`, which produces the same v4 format. npm's only uuid fix was a forced major upgrade.
- **Verification:**
  - Production audit went from 5 findings (1 high) to **0**.
  - `tsc` clean; 73/73 tests pass.
  - Generated IDs match the v4 UUID format.
  - The live dev backend reloaded, reports healthy, and sign-in works.
- **Goal impact:** the live socket that *users'* Desktop apps connect to no longer has a known remotely triggerable crash. Go-live item "production dependency audit shows 0 high or critical findings" is now met for both backends and the Desktop app. The Enterprise client remains, and Phase 2.1 handles it.

### 0.7 Broken Docker files removed; docs match reality

- **Change:**
  - Removed the root `docker-compose.yml` (couldn't be parsed) and `docker-compose.prod.yml` (pointed at a nonexistent client path).
  - Rewrote `README.md` so it describes the actual app (SQLite, PM2, the working incident and ingest features) and marks sign-in, metrics and chat as placeholders.
  - Replaced the README's Security section, which claimed rate limiting, HTTPS and bcrypt that don't exist, with an honest status table.
  - Removed the unused Postgres `DB_*` settings from `.env.example`.
  - Added "outdated" banners to `BACKEND_SETUP.md`, `DEPLOYMENT.md` and `DEPLOYMENT_STATUS.md`.
- **Verification:**
  - 0 stale commands left in the README (`docker-compose`, `createdb`, `psql`, `redis-server` and so on).
  - 0 references to the removed compose files in scripts, CI or active docs.
  - Every local link in the README resolves.
  - The backend boots using only `.env.example` settings and reports healthy; ingest correctly returns 503 until a key is set.
  - Typecheck clean; 10/10 tests pass.
- **Goal impact:** *administrators* and new developers can follow the README without hitting dead ends, and are no longer told the system has security controls it lacks. That matters most before Phase 1, so nobody exposes Enterprise believing it's protected. This supports the Operations go-live item (accurate runbooks).
- **Found along the way, for Phase 1:** `backend/server/src/config/database.ts` (Postgres pool) is never imported, and the `pg` and `redis` dependencies are unused. Remove them during Phase 1 cleanup.

### 0.1 (developer part) Scheduled tasks use a PowerShell that can run them

- **Change** (Desktop repo, PR #2 branch): `register-tasks.ps1` deliberately preferred the Store's `WindowsApps\pwsh.exe` shortcut. Scheduled tasks that run with nobody signed in (S4U) can't launch it, which is the cause of the `0x80070005` failures. The script now prefers the MSI install at `C:\Program Files\PowerShell\7\pwsh.exe`, which has a stable path and works in S4U tasks. If only the Store version exists, it warns and prints the `winget` command to install the MSI.
- **Verification:** the script parses cleanly, and the selection logic picks MSI when present and Store-only with a warning (this server today). **Not yet verified end to end:** that needs the administrator steps below, after which each task must finish with result 0.
- **Goal impact:** this is what keeps Desktop production alive without anyone watching: boot start, nightly backups and health alerts for *administrators*. It unblocks go-live items "services come back after a reboot", "daily backups running" and "alerts tested".

**Phase 0 status:** the developer tasks (0.3, 0.4, 0.5, 0.7, and the developer part of 0.1) are done and verified. Remaining:

- **Admin (elevated window), 0.1 and 0.2:**
  1. `winget install --id Microsoft.PowerShell --source winget --installer-type wix`. The `--installer-type wix` flag matters: winget's default for this package is the Store-style MSIX build, which is already installed and can't run S4U tasks
  2. `cd C:\Projects\DESKSOS-Desktop\backend` then `pwsh scripts/register-tasks.ps1 -BackendAutostart -HealthUrl https://FORD-DC01:5443/health`. It must print `Tasks will use: C:\Program Files\PowerShell\7\pwsh.exe`
  3. `pwsh scripts/start-production.ps1`
  4. Verify: `Start-ScheduledTask "DeskSOS Daily Backup"` and `Start-ScheduledTask "DeskSOS Health Monitor"`, then run `Get-ScheduledTaskInfo -TaskName "DeskSOS Daily Backup"` and the same for the monitor task (one name per call). Both must show `LastTaskResult` 0
- **0.2 done (2026-10-04 10:22):** Desktop production is up. `https://FORD-DC01:5443/health` returns `ok` with the database `ok`, and two production backups were taken at startup.
- **Owner, 0.6:** merge Desktop PR #1, retarget PR #2 to `main`, merge.

### 0.1 and 0.2 completed (administrator steps)

- **Change:** installed PowerShell 7.6.6 from the official MSI (`C:\Program Files\PowerShell\7\pwsh.exe`) alongside the Store version, then re-registered the three tasks with the fixed `register-tasks.ps1`. winget wasn't usable: its default package is the Store-style MSIX build, which reported "already installed". Desktop production was started with `start-production.ps1`.
- **Verification:**
  - All three tasks now launch `C:\Program Files\PowerShell\7\pwsh.exe`.
  - **Daily Backup** finished with result 0 at 10:34 and produced `desksos-2026-10-04T15-34-35.db`, which passes `integrity_check` and contains 22 tickets and 2 users.
  - **Health Monitor** finished with result 0 at 10:35 and recorded `{"up": true}` in `monitor-state.json`. The monitor only writes `monitor.log` on alerts, so an empty log means healthy.
  - Production `https://FORD-DC01:5443/health` returns `ok`.
  - **Backend Startup** shows "has not run" (`267011`) because it only triggers at boot. **It still needs a reboot test**, which is part of the Phase 2 exit gate.
- **Goal impact:** Desktop production is back for *users*. It's now backed up nightly at 02:00 and checked every 5 minutes without anyone signed in, so *administrators* no longer depend on someone remembering to do it. This moves forward go-live items "daily backups running", "health monitor tested" and "services come back after a reboot" (the last one pending the reboot test).
- **Found along the way, for Phase 3.4 / decision D6:** the monitor's email alerts aren't configured (no `ALERT_SMTP_*` or `ALERT_TO`), so an outage is only written to `monitor.log` and nobody is notified.

### 0.6 Desktop PRs merged; `main` current

- **Change:**
  - PR #1 (local dashboard startup, self-hosted PM2 production) merged as `3cd1cb6`.
  - PR #2 retargeted to `main`, then merged as `63dc1a9`. It covers the bridge, P4 priority, legacy cleanup, dependency fixes and the scheduled-task fix.
  - Merge commits were used, not squash, because PR #2 was stacked on PR #1.
  - Before merging, two valid CodeRabbit security findings were fixed (`0b75eb3`):
    - The ingest URL must be HTTPS except for localhost. An invalid URL disables sending instead of crashing the backend.
    - The ingest request refuses redirects.
  - A third finding, ticket-ID collisions, was deferred with reasoning posted on the PR: it's only reachable if tickets are deleted, which no API route does, and changing to UUIDs would change the ticket IDs users see.
- **Verification:**
  - CI ran on PR #2 for the first time (backend, desktop app, end-to-end: all pass), and again on the fix commit.
  - Desktop `main` CI on `63dc1a9` passes on all 3 jobs.
  - Backend tests: 75/75.
  - Redirect fix proven against Node's real `fetch`: with the old default, a cross-origin 307 forwarded `X-API-Key` to the other host; now the redirect is refused.
  - Dev (5000) and production (5443) backends both healthy after the merge.
- **Goal impact:** Desktop's `main` now contains everything production runs, and changes to `main` are tested. Stacked PRs no longer bypass CI. The bridge's API key can't leak over plain HTTP or through a redirect, which protects *clients'* ticket data and the Enterprise ingest credential.
- **Follow-ups:**
  - **Ticket IDs:** decide whether to move to UUIDs (product decision, see the PR discussion).
  - **Dependabot can't patch the Rust crate `glib`** (needs ≥ 0.20, Tauri pins 0.18.5). It's Linux-only and not compiled into the Windows app. Resolve with a Tauri upgrade, and keep it in mind for task 4.4.

**Phase 0 status: complete.** All tasks are verified, except the boot-task reboot test, which moves to the Phase 2 exit gate.

### 1.2 Strong `JWT_SECRET` required; no fallback

- **Change** (`f114dd8`): Enterprise refuses to start if `JWT_SECRET` is missing, shorter than 32 characters, or one of the placeholder values published in this repo. The hard-coded fallback is gone.
- **Two things were found and fixed along the way:**
  - The real `backend/server/.env` contained the **published placeholder** as its secret. It was replaced with a random 64-character value (never printed).
  - A **stale 28-character user-level Windows variable `JWT_SECRET`** overrode both projects' `.env` files, because dotenv never overrides an existing variable. The running Enterprise backend had been signing tokens with it all along. With the owner's approval it was removed, as Desktop's runbook (§3.2) already prescribed. Desktop's `.env` has its own 88-character secret.
- **Verification:**
  - Unit tests cover missing, placeholder, short and valid secrets; the suite passes 14/14.
  - Startup against the built server: placeholder **refused**, short secret **refused**, stale 28-character variable **refused**, strong `.env` secret **starts and is healthy**.
  - After removal, the user variable is gone from the registry and a new shell doesn't see it.
  - Desktop production, Desktop dev and Enterprise stayed healthy throughout.
- **Goal impact:** before this, anyone who read the repo could forge a valid token for the API. This closes that, and moves forward go-live item "no default secrets in code; startup fails if a secret is missing or weak". It protects *users'* accounts once task 1.1 adds them.
- **Operator note:** windows that were already open still carry the old variable. **Start Enterprise only from a newly opened Administrator window** (or restart VS Code first), or it will refuse to start with "JWT_SECRET must be at least 32 characters".
- **Test-harness lesson:** in PowerShell, `[Environment]::SetEnvironmentVariable(name, $null, ...)` sets an empty string instead of deleting. Use `$env:NAME = $null` (process) or `[NullString]::Value` (user or machine).

### 1.1 Real accounts replace the "any password works" login

- **Change:**
  - New `users` table: case-insensitive unique email, name, role (`admin`, `operator` or `viewer`, enforced by a database CHECK), active flag, `must_change_password`, `token_version` and timestamps.
  - Passwords are hashed with Node's built-in **scrypt** (N=32768, random salt, constant-time comparison). The plan said bcryptjs; scrypt avoids another dependency and the native-build problems seen with `bcrypt`.
  - `POST /api/auth/login` checks real credentials. It returns the same 401 for an unknown email, a wrong password or a deactivated account, and takes about the same time in each case.
  - Tokens last **8 hours**, use HS256 only, and carry `token_version`. Changing a password or deactivating an account **invalidates existing tokens immediately**.
  - New `GET /api/auth/me` and `POST /api/auth/change-password` (minimum 12 characters; returns a fresh token). `/register` is removed, since admins create users (task 1.8).
  - **First run:** with no users at all, the server creates `admin@desksos.local` with a random 24-character password, printed once. Until it's changed, that account can only view itself and change its password (`PASSWORD_CHANGE_REQUIRED`).
- **Verification:**
  - 16 new tests; the suite passes 30/30. They cover hashing and salting, login success, case-insensitive email, identical failures, the old placeholder behavior being gone, `/register` returning 404, missing, malformed and forged tokens, instant revocation on deactivation, the forced password change flow, and old tokens dying after a change.
  - Live first-run on a throwaway server: banner printed; login works and is flagged; the change works; the old password is refused and the new one accepted; no password is printed on the second start.
  - Failed-login timing: known email 54 ms, unknown email 53 ms (median of 9).
- **Goal impact:** this closes the most serious gap from the assessment. Before, **anyone could get an admin token with any password**. *Users* now have individual accounts with roles, which is the foundation for tasks 1.3–1.9: protected routes and socket, sign-in screen, user management and audit trail. It moves forward the go-live items for authentication and "default and first-run passwords changed".
- **Administrator note:** the first-run password appears in the startup output, which PM2 also writes to its log file. Because it must be changed at first sign-in, the logged value stops working right away. Sign in and change it promptly after the first deployment.
- **Not yet in effect:** incident, dashboard, chat and user routes are still open. Task 1.3 puts them behind sign-in.

### 1.3 Every API route requires sign-in, with role checks

- **Change** (`d0bd89e`):
  - `requireAuth()` is applied **where routers are mounted** (`/api/incidents`, `/api/dashboard`, `/api/chat`, `/api/user`), so a route added under those prefixes later can't be left open by accident. `/health`, `/api/auth/login` and `/api/ingest` (API key) stay open by design.
  - Creating, updating and locking incidents require the **operator or admin** role. Viewers can read only.
  - Incident locks are now taken in the **signed-in user's name**. Before, the client sent any `operatorName` it liked.
  - `/api/user/me` returns the real user instead of sample data.
- **Verification:**
  - An access-control test calls **all 11 protected routes** with no token and with a forged token: every one returns 401.
  - A pending password change limits the account to `/me` and change-password.
  - Open routes stay open.
  - Viewers get 403 on create, update and lock; operators and admins succeed.
  - Lock names can't be spoofed.
  - **Mutation check:** removing `requireAuth()` from the dashboard mount made 4 access tests fail. Restored, all pass.
- **Goal impact:** the API no longer accepts anonymous reads or writes. Only signed-in *users* see incidents, and only operators and admins change them. This is the core of the Phase 1 exit gate.

### 1.4 Live socket requires sign-in; no identity spoofing

- **Change** (`d0bd89e`):
  - Socket.IO connections must present a valid token at handshake (`auth: { token }`). Forged or expired tokens, deactivated users and accounts with a pending password change are refused.
  - Presence (`user:join`), chat messages and typing events now use the **signed-in identity**. Before, the client supplied its own user ID and name.
  - Viewers can't send chat messages.
- **Verification:**
  - 5 live socket tests on a real server: no token refused, forged token refused, pending password change refused, valid token receives `incident:created` events, and presence shows the real name even when the client sends a spoofed one.
  - **Mutation check:** letting the socket accept connections without a token made 2 tests fail. Restored, all pass.
  - Full suite: **65/65**.
- **Goal impact:** the live incident feed, which shows *clients'* ticket details, is no longer readable by anyone who can open a connection. Nobody can impersonate a colleague in presence or chat.
- **Note:** the dashboard can't sign in yet, so on this branch it can no longer load data. Task 1.5 adds the sign-in screen. This is why the work is on `feat/phase1-secure-enterprise` (worktree `C:\Projects\DESKSOS-phase1`), while `C:\Projects\DESKSOS` stays on `main` and keeps working.

### 1.5 Dashboard sign-in, forced password change, read-only viewers

- **Change** (client):
  - New `auth.js` keeps the token in **sessionStorage** (survives a refresh, not closing the tab) and adds it to every API call.
  - On a 401 it signs out with a notice; on `PASSWORD_CHANGE_REQUIRED` it shows the change screen.
  - New sign-in and change-password screens (minimum 12 characters, confirmation must match), styled like the dashboard.
  - New `Root` component checks a saved token against `/api/auth/me` on load, then shows sign-in, change-password or the dashboard.
  - `App.js` connects the socket with the token and signs out on a socket authentication error. The header shows the signed-in user and a **Sign out** button. The lock no longer sends a name. **Viewers** don't see the incident form or status buttons.
- **Verification:**
  - Production build with `CI=true`, the same as GitHub CI, where lint warnings fail the build: passes.
  - **Real-browser end-to-end run (Playwright + Chromium)** against the built dashboard and the Phase 1 backend with a fresh database. **13/13 checks passed:**
    - signed-out visit shows sign-in
    - wrong password refused with a message
    - first-run admin forced to change password
    - mismatched confirmation caught
    - dashboard opens showing the user
    - incidents load through the authenticated API
    - incident creation delivered live over the authenticated socket
    - lock shows the signed-in name
    - refresh keeps the session
    - sign-out ends it, also after a refresh
    - viewer sees no form
    - viewer sees no status buttons
    - **a deactivated user is signed out automatically** at the next poll
  - Screenshots reviewed: sign-in, change password, admin dashboard, viewer dashboard, session ended.
- **Goal impact:** *users* can now actually use the secured system. Sign-in, first-run setup and sign-out work end to end in a browser, and viewers get a read-only console matching their permissions. With 1.1–1.5 done, the branch is usable again and no longer breaks the dashboard.
- **Note:** the end-to-end harness lives in `C:\tmp\e2e-phase1` for now. It becomes the basis of the automated bridge and UI tests in tasks 4.1 and 4.2.

### 1.6 Security headers, rate limits, body cap, configurable CORS

- **Change** (`25d5f11`):
  - **helmet** security headers on every response, including errors: `nosniff`, frame protection, HSTS, a strict CSP, and no `X-Powered-By`.
  - **Rate limits** per IP per 15 minutes, each configurable in `.env`:
    - general API: 600
    - sign-in: **10 failed attempts per IP + email**; successful sign-ins don't count, so one person's typos don't lock out their colleagues
    - ingest: 2000, kept separate so a Desktop backlog isn't throttled by dashboard traffic
  - **Request bodies capped at 100 KB.** Oversized bodies get a clear 413, malformed JSON a plain 400, and 500 errors **no longer return internal error messages**.
  - **CORS and socket origins come from `CORS_ORIGINS`** instead of being hard-coded. All new settings are documented in `.env.example`.
- **Verification:**
  - 12 new tests: headers present (also on 401s); allowed and other origins; sign-in limit blocks an account after N failures, even with the right password; failures counted per account; successes not counted; general limit returns 429; ingest unaffected; health not limited; 413 and malformed-JSON handling.
  - Live server: the general limit trips at the configured value (`401 ×5, then 429`), ingest keeps returning 201, and the `CORS_ORIGINS` override is honored.
  - Production audit still 0 after adding zod.
- **Found during verification:** the general limiter was first mounted with a regular expression, which **never matches in Express 4**. The live check showed it never triggered. It's now mounted on `/api` with a skip for ingest, and a dedicated test guards it.
- **Goal impact:** brute-forcing *users'* passwords is no longer practical, request floods are capped, and responses carry standard browser protections. This covers go-live security items "security headers" and "login throttled", and prepares the configuration for production (task 2.6: LAN origin).

### 1.7 Input validation on every write route

- **Change** (`e4e6788`):
  - A `validate()` middleware (zod) checks and normalizes bodies and route parameters, trims text, drops unknown fields, and answers bad requests with `400 { error, details[] }` listing every problem.
  - **Incidents:** create is limited to title 1–255, description 1–20000, category and assignee up to 100, severity and status from fixed lists, and coordinates in range. A client-supplied `source` or `id` is ignored.
  - **Status updates** accept only `Open`, `In Progress` or `Resolved`. Before, any string was stored.
  - Incident IDs must be positive integers, and **locking a non-existent incident returns 404** instead of succeeding.
  - **Sign-in** bodies are validated, and passwords are capped at 256 characters.
  - Ingest keeps its existing, already-tested validation.
- **Verification:** 11 new tests covering valid input with trimming and defaults, all problems reported together, whitespace-only and overlong fields, coordinate ranges and null handling, spoofed fields ignored, status list, bad IDs, 404 lock, and auth body checks. Suite: **88/88**. The real-browser end-to-end run still passes **13/13**, so the dashboard's own requests are accepted.
- **Goal impact:** bad or malicious input can no longer corrupt incident data (an arbitrary status, a spoofed source, a lock on a phantom incident). *Clients'* records stay consistent and *operators* get clear messages instead of silent bad data. This is go-live item "invalid payloads return 400 with details".

### Correction (2026-10-05)

FORD-DC01 is a **standalone Windows 11 Pro workstation in a workgroup**, not a domain controller as the original assessment assumed. There's no Active Directory, certificate authority or group policy. Decisions D1 and D4, task 5.4, task 6.6 and the first risk have been updated accordingly.
