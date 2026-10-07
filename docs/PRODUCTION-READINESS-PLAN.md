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
| D6 | **Teams webhook** for alerts. *Changed 2026-10-07 to a **Discord** webhook: the organization uses Teams (free), which has no webhooks or Workflows.* |

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

Updated 2026-10-06 (after the reboot test). Phases 0 and 1 are complete. Phase 2's reboot test passed; its exit gate still needs the dashboard checked from another LAN PC. Track A (runbook, guides, restore drill, bridge alerts, CI, Dependabot, Sentry hook) is done.

1. ~~Owner/Admin: a working alert channel.~~ **Done 2026-10-07:** both monitors alert to Discord, verified with a real outage (see "Alerts to Discord").
2. Admin: **trust the CA on another LAN PC** and open the dashboard there. This is task 2.3 and the rest of Phase 2's exit gate.
3. Dev: **health monitors restart a service that's down** (self-healing), and both runbooks say to start production only through the scheduled tasks.
4. Admin: **off-machine backup share** (3.2, decision D5) and Desktop's restore drill (3.3).
5. Owner: **code signing** (5.1, decision D4). This has the longest lead time.
6. Owner: **branch protection** on `main` in both repos (4.6).
7. Admin: **limit Desktop's firewall rule** ("DeskSOS Backend", TCP 5443) to `LocalSubnet` (decision D3), and turn off Fast Startup (`powercfg /h off`).
8. Owner: set your own Desktop admin password if it's still the reset one, and choose 3–5 pilot PCs (5.4).
9. Owner: Sentry DSN (3.5, optional), the support contact (6.4), and closing the stale Enterprise Dependabot PRs (#1, #3–#9).
10. Later: invite and password-reset emails, once a sender works; the app issues found while writing the guides (see the Track A entry).

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
| 2026-10-05 | 1.8 User management for admins, plus server-side recovery | ✅ Verified (on branch) |
| 2026-10-05 | 1.9 Incident audit trail | ✅ Verified (on branch) |
| 2026-10-05 | 1.10 Ingest key rotation, proven lossless | ✅ Verified (on branch) |
| 2026-10-05 | **Phase 1 exit gate** | ✅ Passed (on branch) |
| 2026-10-05 | PR #11 review: 8 CodeRabbit findings | ✅ All fixed and verified |
| 2026-10-05 | **Phase 1 merged and running locally** | ✅ Verified (admin set up; anonymous API access refused) |
| 2026-10-05 | 2.1 Dashboard moved from Create React App to Vite | ✅ Verified (on branch `feat/phase2-production`) |
| 2026-10-05 | 2.2 Backend serves the built dashboard | ✅ Verified (on branch) |
| 2026-10-05 | 2.3 HTTPS | ✅ Verified (on branch); trusting the CA on other LAN PCs is an admin step |
| 2026-10-05 | 2.4 Production PM2 config and start script | ✅ Verified (on branch, with test overrides); first real production start is an admin step |
| 2026-10-05 | 2.7 Structured logs and security audit log | ✅ Verified (on branch) |
| 2026-10-05 | 2.8 Desktop production → Enterprise production bridge | ✅ Verified end to end (Enterprise branch + Desktop PR #7); key pairing is an admin step |
| 2026-10-05 | 2.5 and 2.6 Start on boot, firewall, backup and monitor tasks | ✅ Scripted and verified (on branch) |
| 2026-10-05 | **Phase 2 merged; production running on FORD-DC01** | ✅ Verified (HTTPS, sign-in enforced, admin password changed, backup and monitor tasks result 0, firewall LAN-only); reboot test pending |
| 2026-10-06 | Overnight outage found: the server PC went to sleep | ✅ Fixed (sleep and hibernate on AC disabled) |
| 2026-10-06 | 2.8 Production ingest keys paired; Desktop → Enterprise verified in production | ✅ Verified twice (07:23 and 09:23 Critical tickets: `201`, live strobe and audio alarm) |
| 2026-10-06 | Desktop production password recovery (Desktop PR #8) | ✅ Merged and used |
| 2026-10-06 | First operator account created (`howard`) | ⏳ Waiting on first sign-in (password change pending) |
| 2026-10-06 | Email alerts (Gmail sender) | ⏸️ Deferred: Gmail rejects the login (`535 BadCredentials`); to be resolved later |
| 2026-10-06 | Documentation and repository cleanup (finishes 0.7) | ✅ Verified (typecheck, 170 tests, build; no broken references) |
| 2026-10-06 | 3.7 + 6.2 Enterprise runbook and administrator guide (`docs/OPERATIONS.md`) | ✅ Verified (every referenced file and UI label exists; read-only procedures run live) |
| 2026-10-06 | 3.3 Restore drill, Enterprise (`restore-drill.ps1`) | ✅ PASS on a fresh production backup (3 incidents, 2 users, 21 events). Desktop's drill still to do |
| 2026-10-06 | 6.1 User guides: Enterprise operators/viewers (`docs/USER-GUIDE.md`) and Desktop technicians (Desktop `docs/TECHNICIAN-GUIDE.md`) | ✅ Verified (every UI label checked against the source) |
| 2026-10-06 | 3.6 Bridge visibility and stuck-queue alerts (Desktop) | ✅ Verified (101 tests; end-to-end stuck → recovered alerts; loopback-only status) |
| 2026-10-06 | 4.3 CI on every PR, both repos | ✅ Verified (a stacked PR triggered CI in each repo) |
| 2026-10-06 | 4.4 Dependabot configuration, both repos | ✅ Config valid, all directories exist; GitHub-side check after merge |
| 2026-10-06 | 3.5 Error tracking: Enterprise Sentry hook + `npm run sentry:test` | ✅ Verified against a local fake Sentry (173 tests); needs a real DSN to finish |
| 2026-10-06 | Outage: both production services stopped at ~14:48 when the window running PM2 closed | ✅ Restored 15:16 via the scheduled tasks; nobody was alerted (email failing) |
| 2026-10-06 | **Phase 2 reboot test** (plus Phase 0's boot task) | ✅ Passed: real reboot 15:17:44; both services came back on their own (tasks result 0). LAN-PC check still to do |
| 2026-10-07 | 3.4 Alerts for both products (Discord) | ✅ Verified: a real stop of Enterprise production → DOWN in Discord from the scheduled monitor; restart → Recovered |

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

### 1.8 User management for admins, plus server-side recovery

- **Change** (`8b48d04`):
  - **`/api/admin/users`** (admins only) to list users; add a user with a **server-generated temporary password, shown once**, which the user must change at first sign-in; change name or role; deactivate and reactivate; and reset a password. Admins never choose or see users' real passwords.
  - **Role changes, deactivation and password resets end that user's sessions immediately.**
  - **Safeguards:** admins can't deactivate or demote themselves, and a backstop check keeps at least one active admin.
  - **Dashboard Users screen** (admins only): add form, one-time password banner with Copy, role picker, deactivate and reactivate, and reset password with a confirmation.
  - **Recovery:** `npm run user:reset-password -- <email>`, run on the server, issues a temporary password and reactivates the account. `--list` shows accounts. This covers the case where nobody can sign in as an admin.
- **Verification:**
  - 12 API tests covering admin-only access, no hashes in responses, onboarding to first sign-in to own password, case-insensitive duplicates rejected, validation details, a role change applying immediately and ending sessions, deactivate and reactivate, reset ending sessions, 404s and empty updates, and self-protection.
  - The access matrix now covers **15 protected routes**. Suite: **107/107**.
  - **Real-browser run, 14/14 checks:** open Users; own row protected; add an operator and see the temporary password; new user forced to set a password and seeing operator features but no Users button; role change; deactivate and reactivate; reset with the old password refused; user back as a viewer; **CLI recovery** temporary password lets the admin sign in. The sign-in flow still passes 13/13.
- **Correction made during review:** a test named "the last active admin can't be removed" actually passed because of the self-protection rule. Through the API the last-admin guard can't be reached, since the acting admin is always another active admin. The test was renamed to what it really proves, and the guard is documented as a backstop.
- **Goal impact:** *administrators* can onboard and offboard staff, adjust permissions and recover accounts **without touching the database**. This is the plan's "done when" for task 1.8. *Users* get their own accounts with a password only they know, and leavers lose access the moment they're deactivated.

### 1.9 Incident audit trail

- **Change** (`520995b`):
  - Append-only `incident_events` table recording **created**, **ingested**, **status_changed** (from → to) and **locked**, with the actor and a timestamp. The actor is the signed-in user, or the integration source for Desktop tickets.
  - Each event is written **in the same transaction** as its change.
  - No-op status updates, re-locks by the same holder and ingest retries add nothing.
  - New `GET /api/incidents/:id/history` for any role.
  - The dashboard's inspection panel shows the history.
- **Verification:**
  - 8 tests: creator recorded, from/to with the user and no-op ignored, lock on holder change only, ingest with the integration actor, retry adds nothing, failed changes leave no event, access rules and 404.
  - **A forced-failure rollback test:** when the event write fails, the incident isn't saved and the 500 doesn't leak the error. **Removing the transaction wrapper makes this test fail**, so it really guards the guarantee.
  - The real browser shows "Created by", "Locked by" and "Open → In Progress by" with the user's name (14/14).
- **Goal impact:** *administrators* and *operators* can see who did what to every incident and when. That gives accountability for *clients'* tickets and evidence for reviews. It meets task 1.9's done criterion.
- **Follow-up:** user-management actions (user added, role changed, deactivated) aren't in an audit log yet. Consider adding them alongside the logging work in task 2.7.

### 1.10 Ingest key rotation, proven lossless

- **Change** (`f2b44ce`): `rotate-ingest-key.ps1` generates a new key and writes it to **both** `.env` files (Enterprise `INGEST_API_KEY`, Desktop `ENTERPRISE_INGEST_KEY`). It checks both are writable first, verifies they match, keeps their other settings and **never prints the key**. The README documents the procedure, along with account handling and CLI recovery.
- **Verification** (end to end, throwaway Enterprise and Desktop instances):
  1. ticket delivered before rotation
  2. script updates both files to the same new key, keeps other lines, prints nothing secret
  3. with only Enterprise restarted, a new ticket is refused (401) and **queued, not lost**
  4. the old key is rejected
  5. after Desktop restarts, **the queued ticket is delivered automatically** (31 s)
  6. new tickets flow normally
- **Goal impact:** *administrators* can replace a possibly exposed credential in one command, without losing *clients'* tickets in the switch. It meets task 1.10's done criterion ("documented and tested once").

### Phase 1 exit gate

**Gate:** automated tests prove no `/api` route or socket event works without a valid token and role, and an independent check finds no open endpoints.

- **Independent check** (`tests/exit-gate.test.ts`): **discovers every route registered in Express** (21), without relying on a hand-written list, and calls each one anonymously.
  - Only a 4-route allowlist may answer without sign-in, each with a stated reason: `GET /` (info), `GET /health`, `POST /api/auth/login` (rate limited) and `POST /api/auth/logout` (no-op).
  - Every other route returns 401. That includes ingest, which returns 401 without its key.
  - The allowlist must match real routes, so a typo can't hide anything.
  - **Mutation check:** adding a hidden unprotected `GET /api/debug/dump` made the gate fail at once.
- **Roles:** the access and role tests show viewers get 403 on every write, and non-admins get 403 on user management.
- **Socket:** connections without a valid token, with a forged token or with a pending password change are refused, and identity can't be spoofed.
- **Totals:** backend **140/140** tests; real-browser flows **14/14** (sign-in, history) and **14/14** (user management and recovery); production dependency audit 0.
- **Result: ✅ passed.** Phase 1's code is complete on `feat/phase1-secure-enterprise`. Remaining step: PR to `main` with CI, then owner review and merge.

### PR #11 review: 8 CodeRabbit findings, all fixed

Each finding was checked against the code before acting. All 8 were valid. Fixed in `21162b0`:

| # | Finding | Fix | Verification |
|---|---|---|---|
| 1 | **Open sockets survived session revocation** (Major). The handshake checked the token once, so a deactivated user kept the live feed. This contradicted "sessions end immediately". | The server tracks every socket per user and disconnects them on deactivation, role change or admin reset. After your own password change it disconnects once the response is sent, so your tab reconnects with its new token. The dashboard sends the current token on each reconnect and checks `/api/auth/me` before signing out. | 5 socket tests. **Mutation:** removing the disconnect fails the deactivation test. **Browser:** a deactivated user's open dashboard was signed out in **32 ms** (precondition verified); your own password change keeps the live feed. |
| 2 | **An admin resetting their own password got signed out before seeing it** (Major), leaving CLI recovery as the only way back | The API refuses a self-reset (400). The Users screen hides Reset on your own row. **New "Change password" button in the header** for everyone, which was also a gap: there was no voluntary password change at all. | Test plus browser check |
| 3 | `rotate-ingest-key.ps1` used `RandomNumberGenerator.Fill()`, **missing in Windows PowerShell 5.1** (Major) | `RandomNumberGenerator.Create().GetBytes()` | Confirmed the old call fails on 5.1; the script now passes on 5.1 and 7 |
| 4 | If the second `.env` write failed, the first wasn't restored (Major) | Files changed by a failed run are restored byte for byte; the error says exactly what happened | Locked the second file to force a failure: both files unchanged, accurate message, on 5.1 and 7 |
| 5 | A resolution released the lock before the update committed | Release only after commit | Forced-failure test: incident stays Open **and** locked |
| 6 | A malformed stored hash made login return 500 | Bounded scrypt parameters, fail closed | 6 malformed formats return false; a corrupt row gives 401 |
| 7 | A network failure left "Add user" stuck | try/catch/finally with a visible error | Code review and build |
| 8 | Overlapping resets possible | One action per user at a time; buttons disabled while working | Code review and build |

**Totals after the fixes:** backend **149/149**; browser **15/15** (sign-in) and **14/14** (user management). Replies posted on each review comment.

### Phase 1 merged and running locally

- **Change:**
  - The owner merged PR #11 (`19205fd`).
  - Local `main` now tracks `origin/main` and was fast-forwarded.
  - New backend dependencies were installed.
  - The temporary worktree, which held a copy of `.env`, and the merged local branch were removed.
  - The owner restarted Enterprise from a new Administrator window. The server created `admin@desksos.local`; the owner signed in with the one-time password and set their own.
- **Verification** (live system, read-only checks):
  - The admin account shows the password change completed (`must_change_password = 0`, token version bumped) and a recorded sign-in.
  - `/health` returns ok.
  - **An anonymous `GET /api/incidents` returns 401.** Before Phase 1 it returned every incident.
- **Goal impact:** Phase 1's protection is now live on the machine, not just on a branch. Next for *administrators*: add the team under **Users**. Next in the plan: Phase 2 (production setup).

### 2.1 Dashboard moved from Create React App to Vite

- **Change** (`d40bf78`, worktree `C:\Projects\DESKSOS-phase2`):
  - Vite 6 and `@vitejs/plugin-react` replace `react-scripts`, which is deprecated.
  - **Tailwind 3.4 is compiled at build time** instead of by the `cdn.tailwindcss.com` script in the browser. Its directives go after the app's CSS to keep the precedence the CDN had.
  - The dev server stays on port 3000 with the same proxy to `:5100`, and the build still goes to `build/`, so `start-dev.ps1`, `stop-dev.ps1` and CI need no workflow changes.
  - `index.html` moved to `client/`, and the JSX files were renamed `.jsx`.
  - CI: the CRA `CI=false` workaround is gone, and the client job now **fails on high or critical production-dependency findings**.
  - `stop-dev.ps1 -ClearCache` targets Vite's cache. README updated.
- **Verification:**
  - **Visual parity with the CRA build:** a script captured 3 screens from each build and compared **252 computed style values: 251 identical**. The one difference is the same gradient written two ways (`0%` vs `0px`). Screenshots match, with no console errors in either build.
  - Browser flows on the Vite build: 15/15 and 14/14.
  - The dev server serves the page and forwards `/health` and `/api` to the backend.
  - The build has **no inline scripts**, which the strict security policy requires.
  - **Client production audit: 80 findings to 0.**
- **Remaining (build tools only):** 5 high findings, all one advisory in `braces` (deeply nested glob patterns), pulled in by Tailwind 3's build tooling. The only patterns it processes are the two in `tailwind.config.js`, and nothing reaches the browser. The fix is Tailwind 4, a major upgrade with class renames, deferred to avoid risking the visual parity.
- **Goal impact:** *users* get the same dashboard built with supported tools, with styles compiled once instead of in every browser, and the shipped dependencies have no known vulnerabilities. This unblocks 2.2 and moves forward go-live item "production audit 0 high or critical".

### 2.2 Backend serves the built dashboard

- **Change** (`4a1405d`):
  - When `SERVE_CLIENT` is on (the default in production), the backend serves `client/build`. Hashed `/assets` files are cached for a year and `index.html` is never cached.
  - Client-side routes fall back to `index.html`, but `/api`, `/socket.io` and `/health` are excluded, so **unknown API paths still return a JSON 404**. A missing build is logged rather than crashing the server.
  - API information moved to `GET /api` as well.
  - The security policy keeps helmet's strict defaults (`script-src 'self'`, no inline scripts). **`upgrade-insecure-requests` is only sent once HTTPS is on**: browsers would otherwise fetch the server's own files over HTTPS and break a plain-HTTP deployment.
- **Verification:**
  - 7 new tests: `/` serves `index.html` uncached; assets get the immutable year-long cache; a missing asset returns 404, not the page; root static files are served; deep links return the page; API, health and auth unchanged (unknown API path gives JSON 404, incidents give 401); the policy forbids inline scripts and has no upgrade directive.
  - The exit gate caught the new open `GET /api` until it was added to the allowlist with its reason. Suite: **157/157**.
  - **Real browser against the backend serving the Vite build on one port, no proxy:** **17/17**, including **no security-policy violations** and **no unexpected console errors**. User management passes 14/14.
  - The violation check was proven able to fail: temporarily restricting `style-src` to `'self'` made it report the blocked Google Fonts stylesheet.
- **Goal impact:** production can run as **one server on one port**, with no development server, no CDN and a strict security policy. This is the plan's "done when" for task 2.2, and the base for HTTPS (2.3) and the production start script (2.4).

### 2.3 HTTPS

- **Change** (`3bb37d2`):
  - The server runs HTTPS when `TLS_CERT_PATH` and `TLS_KEY_PATH` are set (paths relative to `backend/server`). One without the other is fatal, and **production refuses to start without HTTPS** unless `ALLOW_HTTP_IN_PRODUCTION=true` (for a TLS proxy). An unreadable certificate or key, or a busy port, gives a clear fatal message.
  - With HTTPS on, the security policy adds `upgrade-insecure-requests`. HSTS was already sent.
  - **Production loads its own secrets** from `backend/server/.env.production`, which git ignores. A shared `JWT_SECRET` would let development tokens work on production, because user IDs exist in both databases.
  - `scripts/gen-cert.ps1` finds mkcert even off PATH and issues a certificate from this PC's mkcert CA (the one Desktop already uses, and already trusted here). It covers `localhost`, `127.0.0.1`, `FORD-DC01` and the physical LAN address, skipping Hyper-V and WSL adapters. It exports the CA's **public** certificate for other PCs, never its key. `certs/` is ignored by git.
  - The README covers setup, trusting the CA on LAN PCs (Chrome, Edge, Firefox) and `NODE_EXTRA_CA_CERTS`.
- **Verification:**
  - 5 config tests. Certificate issued for exactly the expected names; no private key copied; files ignored.
  - **Real browser over HTTPS with normal certificate validation**, backend serving the dashboard: **17/17**. That includes the `wss://` live feed, sign-out of a deactivated user in 41 ms, and **no security-policy violations with the upgrade directive active**. User management passes 14/14.
  - Windows validates the certificate, HSTS is present, and plain HTTP to the HTTPS port fails.
- **Found:** Node.js doesn't use the Windows certificate store. The test's Node request failed until given `NODE_EXTRA_CA_CERTS`. **The Desktop bridge (Node) will need the same in task 2.8.**
- **Admin step remaining:** import `desksos-ca.crt` on each other LAN PC that opens the dashboard (README → HTTPS).
- **Goal impact:** *users'* sign-in tokens and *clients'* incident data are encrypted on the network, browsers trust the site without warnings, and production can't accidentally run unencrypted. This covers go-live item "HTTPS with a certificate trusted on client PCs" (pending the per-PC import).

### 2.4 Production PM2 config and start script

- **Change** (`ccc3db0`):
  - `backend/server/ecosystem.config.js` defines PM2 app `desksos-enterprise`: port **5543**, `data/enterprise-prod.db`, HTTPS, dashboard served, restart policy, memory limit, logs.
  - `start-production.ps1` (Administrator, PowerShell 7):
    - checks PM2 reachability
    - creates `.env.production` with its own `JWT_SECRET` and `INGEST_API_KEY` if missing (never printed)
    - creates the certificate if missing, and warns under 30 days
    - builds, or uses `-SkipBuild`
    - replaces any previous instance, then starts and saves under PM2
    - waits for HTTPS health
    - on a new database, shows how to read the one-time admin password, taking the real log path from PM2 (PM2 adds the process ID to log names)
  - **`.env.production` now overrides inherited variables**, so a stale value from a shell or the PM2 daemon can't replace production secrets. `DATABASE_PATH` is resolved from `backend/server`.
- **Verification** (real PM2 daemon, with test name, port and database overrides so production wasn't touched):
  - **Run 1** (full build): secrets generated, certificate valid for 823 days, healthy over HTTPS in production mode.
  - **Run 2** (`-SkipBuild`, as the boot task will use it): **kept the existing secrets**, replaced the instance, exactly one registration, dev instance untouched, healthy.
  - **Production browser flow over HTTPS against the PM2 instance: 17/17**, with no sample data (correct for production).
  - **Override proven:** with a stale 28-character `JWT_SECRET` deliberately inherited, production still started with its own secret.
  - Production without HTTPS: **refused**.
  - The recovery script works against the production database.
  - Afterwards the test instance was removed, PM2's saved list re-saved (no trace in the dump), and the test secrets deleted.
- **Admin step remaining:** after merging, run `.\start-production.ps1` once from an Administrator PowerShell 7 window, then sign in with the one-time production admin password and change it.
- **Goal impact:** *administrators* start or restart production with **one command that's safe to repeat**, with its own port, database and secrets. This is task 2.4's "done when". Restart on boot (2.5) builds on it with `-SkipBuild`.

### 2.7 Structured logs and security audit log

- **Change** (`5658468`):
  - winston writes to stdout and stderr: **JSON lines in production**, short readable lines in development, silent in tests. PM2 captures the output, and the already-configured **`pm2-logrotate`** rotates it (daily, **14 days**, compressed, 10 MB cap), so there are no extra log files or dependencies.
  - **Request log**, which runs first so body-parser errors are logged too: method, path without the query string, status, duration, user and IP. Health checks and static files are logged at debug.
  - **Security audit events**, closing the 1.9 follow-up, each recording who did it: `auth.login`, `auth.login_failed`, `auth.password_changed`, `auth.password_change_failed`, `user.created`, `user.updated` (from → to), `user.password_reset`.
  - **Never logged:** passwords, temporary passwords, tokens, keys.
  - The first-run banner stays plain text deliberately, because scripts read it.
  - Production `LOG_LEVEL=info` is set in `ecosystem.config.js`, since the shared `.env` sets `debug` for development. The README has a new Logs section.
- **Verification:**
  - 8 tests: request fields, the query string left out, levels, body-parser errors logged, audit events with actor and changes, **no password, temporary password or token in any entry**. Suite: **170/170**.
  - **Live production run:** every stdout line parses as JSON except the 6-line first-run banner. At `info` level, routine requests (health, page) produce no lines while an API refusal does.
- **Found:** production first logged health checks at debug level because it inherited `LOG_LEVEL=debug` from the shared `.env`. Fixed by setting `info` in the PM2 production config.
- **Goal impact:** *administrators* can see who signed in, who failed, and who created, changed or reset accounts, and search request history by status, path or user, without logs filling the disk. Covers go-live item "logs rotate", and supports security reviews and incident handling.

### 2.8 Desktop production → Enterprise production bridge

- **Change:**
  - **Desktop PR #7** (`d529b57`): production loads `backend/.env.production` with override (for its own `ENTERPRISE_INGEST_KEY`). `env_production` points at `https://localhost:5543/api/ingest/incidents`, source `desksos-desktop-prod`, and sets **`NODE_EXTRA_CA_CERTS`** to the mkcert root CA. Bridge errors now include fetch's underlying cause. `.gitignore` now covers `.env.production`, which it didn't before. OPERATIONS.md 3.8 updated.
  - **Enterprise** (`6d8dbe3`): `rotate-ingest-key.ps1 -Production` pairs the two production keys, creating Desktop's file if needed. README updated.
- **Verification:**
  - Desktop tests **80/80**, 5 new.
  - **`-Production` rotation** on PowerShell 5.1 and 7: production `JWT_SECRET` untouched, one key line, keys match, nothing printed.
  - **End to end with throwaway production-mode instances, both over HTTPS:**
    - **with** `NODE_EXTRA_CA_CERTS`, Desktop's P1 ticket arrived in Enterprise as **CRITICAL** from `desksos-desktop-prod` (Enterprise logged `POST /api/ingest/incidents 201`)
    - **without** it, delivery failed and the ticket stayed queued. The setting is required, not decorative.
- **Found during verification:**
  - A first test run reported production's `JWT_SECRET` as not kept. The **test data** was malformed: in PowerShell the comma binds tighter than `+`, which joined two lines into one. The script was correct, and the rerun with proper data confirmed it.
  - Node's "fetch failed" hid the certificate error. Desktop now logs the cause.
- **Admin step remaining** (after Enterprise production is running): `.\rotate-ingest-key.ps1 -Production`, then restart both production backends.
- **Goal impact:** tickets raised on *client* PCs through Desktop production reach the Enterprise production dashboard encrypted and authenticated, with production and development fully separated (keys, sources, databases). This is the plan's "done when" for 2.8, pending the admin pairing step.

### 2.5 and 2.6 Start on boot, firewall (and backup and monitoring): scripted

- **Change** (`092f0d7`): `register-production-tasks.ps1`, run once from an Administrator PowerShell 7 window, sets up the following:
  - **Startup** task at boot +3 minutes, calling `start-production.ps1 -SkipBuild`. Desktop's task runs at +1 minute, and two PM2 commands at once can each spawn a daemon.
  - **Daily Backup** task at 02:30 (`backup-prod.ps1`): the production database goes to `backups\production`, 14 kept. This brings task 3.1 forward.
  - **Health Monitor** task every 5 minutes (`monitor-health.ps1`). It validates the certificate, alerts once on DOWN and once on recovery, retries alerts that failed, and warns daily before the certificate expires. Alerts go to Teams (decision D6) via `ALERT_TEAMS_WEBHOOK_URL`, and to email via `ALERT_SMTP_*`.
  - **Firewall rule** allowing inbound TCP 5543 from **LocalSubnet only**, on every profile (decision D3). It's scoped by address, so it still holds if the network profile changes.
  - The tasks run with S4U and highest privileges, using the MSI PowerShell only. `-DryRun` previews without admin rights, and `-Unregister` removes everything. The README is updated.
- **Verification:**
  - **Register script:** parses cleanly, and the dry run lists exactly the three tasks and the rule. A real run without admin rights is **refused**.
  - **Backup:** with no database yet it exits 0; a normal backup passed integrity verification; with the database deleted while backups exist it **exits 1**.
  - **Monitor:** tested against a real HTTPS instance with a fake Teams webhook through a full outage:
    - up: no alert
    - stopped: one DOWN alert, not repeated on the next run
    - recovered while the webhook was down: state held, then Recovered delivered on the next run
    - certificate warning sent once per day
    - cards use the Adaptive Card format
    - a certificate name mismatch counts as down
- **Admin step remaining:** after merging, and after `start-production.ps1` has run once, run `.\register-production-tasks.ps1` as Administrator. Start the backup and monitor tasks and check that both show `LastTaskResult` 0, then do a reboot test. Set `ALERT_TEAMS_WEBHOOK_URL` once a webhook exists.
- **Goal impact:** production survives reboots without anyone signing in, is reachable only from the office LAN, is backed up nightly, and *administrators* hear about an outage within 5 minutes instead of from *users*. These are the "done when" conditions for 2.5 and 2.6, met once the admin step is done.

### Phase 2 merged; production running on FORD-DC01

- **Change:**
  - The owner merged PR #12 (`9267f8b`). Its server CI job had been cancelled on every push because GitHub never assigned it a runner (no runner name, no steps; the docs-only commit `c5a8ff1` on `main` hit the same). A re-run passed in 28 seconds, and the 170 server tests also passed locally.
  - The owner ran `start-production.ps1` from an Administrator PowerShell 7 window. It generated `.env.production` (new `JWT_SECRET` and `INGEST_API_KEY`) and the HTTPS certificate (localhost, 127.0.0.1, FORD-DC01, 192.168.12.196; expires 2029-01-05).
  - **The first build failed** with `'vite' is not recognized`: the script only ran `npm ci` when `node_modules` was missing, so the old Create React App packages stayed after the pull. The owner ran `npm ci` in `client` (after `stop-dev.ps1`, since the old dev server held those files) and the second run succeeded. Fix: the script now reinstalls when `package-lock.json` is newer than the last install (`node_modules\.package-lock.json`); branch `fix/start-production-stale-deps`.
  - The owner signed in to production with the one-time password and set their own, then ran `register-production-tasks.ps1`.
  - **The firewall rule alone wasn't enough.** Four pre-existing "Node.js JavaScript Runtime" rules (TCP and UDP for two `node.exe` paths, from Windows' Allow prompt) allowed Node on every port from any address, on the Private and Public profiles, which overrides a scoped rule. This PC also has a public IPv6 address. The owner limited all four to `LocalSubnet` with edge traversal blocked (`Set-NetFirewallRule -EdgeTraversalPolicy Block -RemoteAddress LocalSubnet`; the rules' "Defer to user" setting had to be turned off for the address limit to apply).
- **Verification** (live system):
  - `https://FORD-DC01:5543/health` and `https://192.168.12.196:5543/health` return ok, with the certificate trusted on this PC. Windows `curl.exe` needs `--ssl-no-revoke`, because the local CA has no revocation list; browsers and the PowerShell monitor are unaffected.
  - An anonymous `GET /api/incidents` returns **401**. `/` and `/users` return the Vite dashboard; an unknown `/assets/*.js` returns 404. HSTS and the Content-Security-Policy are present.
  - The audit log shows `auth.login` and `auth.password_changed` for the production admin.
  - **Daily Backup** and **Health Monitor** tasks: `LastTaskResult` 0. The backup `backups\production\enterprise-2026-10-05T21-33-32.db` passed its integrity check. The monitor recorded the service as up. **Startup** shows `267011` (not run yet; it runs at boot).
  - Firewall: the four Node.js rules show `remote=LocalSubnet`, `edge=Block`; production still answers afterwards.
- **Remaining:**
  - **Reboot test** (Phase 2 exit gate, plus Phase 0's boot task): restart, don't sign in for 5 minutes, then check that both production services are up.
  - Alert channel: set `ALERT_TEAMS_WEBHOOK_URL` or `ALERT_SMTP_*`. Until then, alerts are only written to `monitor.log`.
  - Trust the CA on the other LAN PCs (task 2.3), and pair Desktop production with the production ingest key (task 2.8).
  - DeskSOS Desktop's own firewall rule ("DeskSOS Backend", TCP 5443) still allows any address; limit it to the LAN as well (decision D3).
  - If Windows shows the Node.js network prompt again (for example after a Node update), Allow creates a new unrestricted rule; limit it the same way.
- **Goal impact:** Enterprise production is live for *users* on the office LAN over HTTPS, with real accounts and a changed admin password. *Administrators* get nightly backups and a health check without anyone signed in, and the dev and production services are no longer reachable from outside the LAN. Moves forward go-live items "HTTPS ... firewall limited to the LAN", "default and first-run passwords changed" and "daily backups running"; "services come back after a reboot" waits on the reboot test.

### Production bridge verified; overnight sleep found and fixed (2026-10-06)

- **Overnight outage:**
  - The health monitor logged DOWN from 03:16 to 06:20. PM2 shows the process never stopped.
  - The Windows log shows FORD-DC01 entering **Modern Standby**: the PC slept after 5 idle minutes on AC power. It woke briefly for the 02:30 backup, which succeeded, and resumed when someone moved the mouse at 06:20.
  - Both products were unreachable from the LAN while it slept.
  - **Fix:** `powercfg /change standby-timeout-ac 0` and `powercfg /change hibernate-timeout-ac 0`. Verified: both AC settings read `0x0`. The screen can still turn off.
- **Why the first test ticket didn't arrive:**
  - It was sent from the **development** Desktop app (`tauri-app\src-tauri\target\debug\desksos.exe`), which talks to Desktop dev (`localhost:5000`). Desktop dev forwards to Enterprise dev (`:5100`), which was stopped.
  - Those tickets sit in the dev outbox as pending (`ECONNREFUSED`) and are delivered when Enterprise dev next runs.
  - Desktop production was also still running code from 2026-10-04, without a production ingest key.
- **Changes:**
  - Desktop checkout moved to `main` with PR #7 (production bridge).
  - The owner paired the production keys (`rotate-ingest-key.ps1 -Production`) and restarted both production services. Desktop logged `Forwarding new tickets to https://localhost:5543/api/ingest/incidents as "desksos-desktop-prod"`.
  - Desktop production's accounts have random passwords that were no longer known, and `change-password.ps1` needs the current one. Desktop PR #8 adds `backend/scripts/reset-password.js --prod <email>`. CodeRabbit's finding (a mistyped `--prod` silently reset the dev database) was fixed before merge; 84 tests pass.
  - The owner created the first operator account (`howard`) in the Users screen. Enterprise sends no email, so the temporary password is handed over in person; that one should be reset before use, because it appeared in a screenshot.
- **Verification** (live, production):
  - Critical tickets from the release Desktop app at **07:23:28** and **09:23:27** each produced `POST /api/ingest/incidents 201` in Enterprise production's log, in the same second.
  - The dashboard raised the tactical strobe, the Critical Alerts count rose, and with Tactical Audio armed the alarm and voice played.
  - Priority mapping checked in code: Critical → CRITICAL (alarm); High → HIGH; Medium and Low → no alarm.
- **Notes for operators:**
  - Tactical Audio must be re-armed after every page refresh (browser autoplay rule).
  - The alarm sounds only in dashboards that are open at the time.
  - Production and dev have separate accounts in both products: Enterprise `admin@desksos.local`, Desktop `admin@desksos.com`.
- **Goal impact:**
  - Task 2.8's "done when" is met in production: a ticket in Desktop production appears in the Enterprise production dashboard.
  - *Users* reporting a critical problem now raise an immediate audible alarm for *administrators*, and production no longer drops off the LAN overnight.
  - Moves forward "Bridge" and "Accounts created for every launch user"; "services come back after a reboot" still waits on the reboot test.

### Email alerts: deferred (2026-10-06)

- **Goal:** email outage alerts now (`monitor-health.ps1` already supports SMTP), and later invite and password-reset emails for new users. Enterprise sends no email today, so admins hand temporary passwords to users themselves.
- **Done so far:**
  - The owner created a dedicated sender, `desksos.alerts@gmail.com`, with 2-step verification and an app password.
  - User-level environment variables for the Administrator account (which the monitor task runs as): `ALERT_SMTP_HOST=smtp.gmail.com`, `ALERT_SMTP_PORT=587`, `ALERT_SMTP_USER=desksos.alerts@gmail.com`, `ALERT_TO=hneal.foes@gmail.com`, and `ALERT_SMTP_PASS` (16 characters, app-password format).
- **Blocked:**
  - The connection, STARTTLS and TLS 1.3 to `smtp.gmail.com:587` all work, but Gmail answers `AUTH` with **`535 5.7.8 BadCredentials`**, including with a second app password created in an Incognito window signed in to the new account.
  - `Send-MailMessage` reports this only as "connection was closed".
  - Likely causes:
    - Google holding a new account's SMTP sign-in as suspicious: check the account's inbox and `myaccount.google.com/notifications` for a blocked-sign-in alert and approve it.
    - A delay before a new account's app password works.
- **Effect until resolved:** in an outage, the monitor still logs DOWN and Recovered, but each email attempt fails, is logged as "Email failed", and retries on the next run. Nobody is notified.
- **To resume:**
  1. Approve any blocked sign-in, then retest the SMTP login. Diagnose with a raw `AUTH PLAIN` exchange, because `Send-MailMessage` hides Gmail's reply.
  2. If it still fails, use an established account's app password, or set `ALERT_TEAMS_WEBHOOK_URL` instead.
  3. Re-save the password with `Get-Credential`, not `Read-Host -AsSecureString`: pasting into a hidden `Read-Host` prompt in the VS Code terminal stores a single control character.
- **Pasting secrets:** hidden prompts in the VS Code terminal don't accept pastes, and copying a command overwrites a code already on the clipboard. A `Get-Credential` pop-up worked.
- **Later:** invite and reset emails (one-time set-password link, not the password; links only work on the office LAN) will reuse this sender once it works.

### 3.7 + 6.2 Enterprise runbook and administrator guide; 3.3 restore drill (2026-10-06)

- **Change:**
  - **`docs/OPERATIONS.md`**, for an administrator who wasn't part of the build:
    - at a glance (production versus dev, tasks, firewall)
    - daily, weekly and quarterly checks
    - start, stop and restart
    - upgrade and rollback
    - backup, restore and the restore drill
    - accounts: onboarding, role changes, offboarding, forgotten passwords, all admins locked out, audit trail
    - rotating secrets: JWT secret, ingest key
    - the HTTPS certificate: renewal, trusting it on other PCs
    - server PC settings: sleep, the Node.js firewall rules, the network profile
    - alerts and their current status
    - removing production
    - a troubleshooting table built from the problems actually hit on 2026-10-05 and 2026-10-06
  - **`backend/server/scripts/restore-drill.ps1`** restores the newest (or a given) backup to a temporary folder without touching production:
    - checks its integrity and counts incidents, users and history events
    - serves it from a throwaway server on port 5199, with a temporary secret and no production settings, and checks `/health` and that `/api/incidents` requires sign-in (401)
    - cleans up and appends `PASS` or `FAIL` to `logs/restore-drill.log`
  - **README:** links to the runbook. Two stale claims fixed:
    - "temporary passwords are never logged": the first-start admin password is printed to the PM2 log, once
    - a reference to the deleted repo-root `.env`
- **Verification:**
  - **Restore drill:**
    - **PASS** on the 02:30 backup and on a fresh production backup taken at 14:26: 3 incidents, 2 users, 21 history events, served healthy.
    - Negative tests: a corrupt file gives `FAIL` (not a readable SQLite database) and a missing file gives `FAIL`, both with exit 1.
    - No scratch folder or listener is left behind in any case.
  - **JWT rotation steps:** tested on a scratch copy. Exactly one `JWT_SECRET` line, the old value removed, other keys kept, a 64-character secret, and running twice is harmless. Never run on the real file.
  - **Runbook references:** every file and script exists. Every UI label it names is in the dashboard source (Add user, Copy, Reset password, Deactivate, Reactivate, Change password, Tactical Audio, Acknowledge, "Password change pending").
  - **Read-only procedures run live:**
    - daily checks: health ok, last backup verified, tasks 0/0, Startup `267011` (it hasn't run since registration)
    - sleep on AC `0x0`
    - Node.js rules `LocalSubnet`
    - firewall rule present
    - `register-production-tasks.ps1 -DryRun`
    - the lockout procedure's `user:reset-password -- --list` against `enterprise-prod.db`
  - **One finding:** the reset tool failed in a shell that had inherited a stale 28-character `JWT_SECRET`. That variable is no longer set at user or machine level, so fresh windows aren't affected, and the runbook's troubleshooting table covers it.
- **Remaining for 3.3:** a drill for Desktop's database, then the quarterly repeats.
- **Goal impact:**
  - *Administrators* can run, upgrade, restore and secure Enterprise from one document, and prove backups restore in one command.
  - Moves forward the go-live items "Runbooks for both products cover…" and "Restore drill passed within the last 30 days" (Enterprise half).

### Alerts to Discord (2026-10-07)

- **Why Discord:** decision D6 chose a Teams webhook, but the organization uses **Teams (free)**, which has no Workflows or incoming webhooks. Gmail still rejects the sender's login (`535`). The owner chose a **Discord** channel webhook instead: a private "DeskSOS Alerts" server, with phone notifications through the Discord app.
- **Changes (Enterprise PR #29, Desktop PR #29):**
  - **New channel:** both health monitors gained `ALERT_DISCORD_WEBHOOK_URL`, a plain message with mentions disabled and the length capped below Discord's 2,000-character limit. Desktop's monitor, which could only email, also gained Teams, so both products now support the same channels.
  - **Delivery rule changed:** an alert now counts as **delivered if any channel succeeds**. Previously, one broken channel (Gmail) kept the state unchanged, so a working channel would have repeated the alert every 5 minutes. It's retried only if every channel failed.
  - The webhook URL is stored as a user-level environment variable, entered through a `Get-Credential` pop-up and never shown.
- **Verification:**
  - **Fake endpoints:** with Teams or Discord working and email refused, there was exactly one message per outage, then "Still down". With every channel failing, the alert was retried on the next run.
  - **Payload:** username `DeskSOS`, `allowed_mentions.parse = []`, about 250 characters.
  - **Live drill:** both monitors' real code sent DOWN and Recovered to the Discord channel (temporary log folders, so the production monitor state wasn't touched).
  - **Real outage test:** the owner ran `pm2 stop desksos-enterprise`. The **scheduled** "DeskSOS Enterprise Health Monitor" task (result 0) logged `ALERT: DOWN` and `Sent to Discord` at 07:57:38. `Start-ScheduledTask "DeskSOS Enterprise Startup"` restored it in about 48 seconds, in the same PM2 daemon. The next monitor run logged `ALERT: Recovered` and `Sent to Discord` at 07:59:34, and the state returned to `up: true`.
- **Remaining:**
  - Email is still configured and failing. Each alert also logs `Email failed`, which is harmless now. Fix Gmail or remove the `ALERT_SMTP_*` variables.
  - The alert channel lives on this PC. If the PC itself dies, no alert is sent. A check from a second machine, or an external uptime service (LAN only, so it would need an agent), is a later improvement.
- **Goal impact:** go-live item "Health monitor and alerts tested by stopping each service" is met for Enterprise. Desktop's monitor uses the same channel and code and was drill-tested, but not yet stopped for real. *Administrators* now hear about an outage within 5 minutes on their phone, instead of not at all, as happened on 2026-10-06.

### Outage and reboot test (2026-10-06)

- **Outage, about 14:48 to 15:16:**
  - **What stopped:** both production services (Enterprise `:5543` and Desktop `:5443`). Enterprise's last request was at 14:47:46. Windows logged an app window closing at 14:48:23.
  - **Cause:** the PM2 daemon had been started from an interactive Administrator window that morning. On Windows, the daemon dies with the console that started it, taking every app with it. `pm2.log` has no stop entries, just "New PM2 Daemon started" at 15:07, when Desktop production was rebuilt from another window, which then died the same way.
  - **Detection:** both health monitors logged DOWN every 5 minutes, but **every alert failed** (Gmail 535), so nobody was told.
  - **No data was lost.**
  - **Restored at 15:16** with `Start-ScheduledTask "DeskSOS Backend Startup"` and `"DeskSOS Enterprise Startup"`. Both returned 0, and one daemon now runs both apps with no window attached.
- **A restart that didn't happen:** a restart started from Settings at 15:13:07 was logged at 15:14:13 as "the attempt to restart … failed" (cancelled). `LastBootUpTime` still showed 2026-09-22. Fast Startup is also on (`HiberbootEnabled = 1`), so a *shutdown* and power-on resumes Windows rather than booting it.
- **Reboot test, passed:**
  - **The PC rebooted** at 15:17:44.
  - **Desktop:** its startup task (boot trigger + 1 minute, S4U) ran at 15:19:00, *before* the first sign-in at 15:19:05. PM2 brought `desksos-backend` online at 15:19:39.
  - **Enterprise:** its startup task (boot trigger + 3 minutes, S4U) ran at 15:21:00, and `desksos-enterprise` was online at 15:21:05.
  - **Task results:** both 0. Both triggers are `MSFT_TaskBootTrigger` with S4U logon, so neither depends on anyone signing in.
  - **After the reboot:** both `/health` ok, and Desktop's `/health/bridge` shows `pending 0, sent 3`.
- **Also found:** before the restart, VS Code saved an old open copy of this plan over the current file, with some stray dictated words. It was restored from git; nothing committed was affected. Before closing VS Code, don't "save all" over files that have changed on disk; reload them first.
- **Follow-ups (in §9):**
  - a working alert channel first
  - self-healing monitors
  - "start production only through the scheduled tasks" in both runbooks
  - Fast Startup off
- **Goal impact:** the go-live item "Both services come back after a reboot without anyone signing in (tested)" is met. The Phase 2 exit gate still needs the dashboard checked over HTTPS from another LAN PC.

### Track A: user guides, bridge visibility, CI, Dependabot, error tracking (2026-10-06)

- **6.1 User guides:**
  - **Enterprise `docs/USER-GUIDE.md`** (operators and viewers): sign-in and the first password change, the dashboard, Critical alarms and arming audio, select/lock, status changes, logging incidents, viewer access. All 36 labels it names exist in `client/src`. Two wrong names were caught and fixed: the password fields, and the audio button "🔇 Click to Arm Audio" (also corrected in the runbook).
  - **Desktop `docs/TECHNICIAN-GUIDE.md`:**
    - every sidebar page
    - the Ticket Builder with priority guidance (Critical raises Enterprise's alarm)
    - Fix It and Net Fixes, with admin-rights and disruption notes
    - chat, remote sessions and troubleshooting

    Labels were checked against `tauri-app/src`. Unverified admin-rights claims are marked "Likely".
- **3.6 Bridge visibility (Desktop):**
  - **Admin endpoint:** `GET /dashboard/bridge` returns counts, the age of the oldest undelivered ticket, and each undelivered ticket's last error.
  - **Monitor endpoint:** `GET /health/bridge` returns counts only, and answers loopback requests only (live: 200 via `localhost` and `127.0.0.1`, 404 via `192.168.12.196` and `FORD-DC01`).
  - **Alerts:** `monitor-health.ps1` alerts once at 60 minutes stuck, once on recovery, and once per batch of rejected tickets.
  - **Verification:** 17 new tests (101 total), plus an end-to-end run against a scratch backend: stuck gives one alert, a repeat run gives no duplicate, and delivery gives "recovered".
- **4.3 CI on every PR:** both repos' `pull_request` triggers no longer filter on `main`. Verified with a throwaway stacked PR in each repo; both triggered CI and were closed.
- **4.4 Dependabot:** `.github/dependabot.yml` in both repos, pointing at the real folders:
  - Enterprise: `backend/server` and `client`
  - Desktop: `backend`, `tauri-app` and `tauri-app/src-tauri` (cargo)
  - both: GitHub Actions

  Minor and patch updates are grouped weekly. The existing Dependabot security PRs in Enterprise (#1, #3–#9) target `/server`, which no longer exists, and should be closed.
- **3.5 Error tracking (Enterprise):**
  - **Hook:** `src/instrument.ts` starts Sentry only when `SENTRY_DSN` is set (never in tests), errors only. Before sending, it removes `Authorization`, `X-API-Key`, cookies, request bodies and query strings containing tokens or keys.
  - **Test command:** `npm run sentry:test` sends one test error.
  - **Verification:** 3 new tests (173 total). Against a local fake Sentry endpoint, the test command delivered exactly one envelope (environment tagged); with no DSN it refused and sent nothing; and the server ran normally with a DSN set.
  - **Remaining (owner):** create a Sentry project and set `SENTRY_DSN` for Enterprise and Desktop production, then run the test command.
- **Findings for later** (user-visible issues seen while writing the guides):
  - **Enterprise dashboard:**
    - the Critical Alerts and High Severity counters include resolved incidents
    - the new-incident form is pre-filled with demo values (`Node-Ops-Lead`, Los Angeles coordinates)
    - a failed submit gives no message
  - **Desktop:**
    - Remote Session likely fails to connect (the answer goes to an undefined target)
    - "Submitted!" can be clicked again and creates a duplicate ticket
    - switching pages loses a half-written ticket
    - Fix It and Kill run without confirmation
    - the app never checks admin rights
    - Fix It shows its results in quotes
    - the ticket's "DNS (8.8.8.8)" line is actually a ping
    - the sign-in email placeholder suggests the shared admin login

### Documentation and repository cleanup (2026-10-06)

- **Why:**
  - `docs/API_REFERENCE.md` and `openapi.yaml` (February 2026) described an API that never existed: `/v1` paths, `/services`, `/config`, `/deployments` and `/logs` endpoints, a user DELETE, roles `admin|user|viewer`, and different error shapes and rate limits. They omitted sign-in, incidents, ingest and Socket.IO.
  - An audit of every other tracked file found only two current: `backup-desksos.ps1` and `.env.example`.
  - **Task 0.7 had only removed the root compose files.** Copies under `backend/`, three Dockerfiles and two nginx trees were still tracked.
- **Change:**
  - `docs/API_REFERENCE.md` and `openapi.yaml` were rewritten from the code. They cover every real endpoint with roles, bodies, responses and errors, plus ingest idempotency, Socket.IO events, rate limits and examples.
  - **Removed (48 files):**
    - Outdated docs: `BACKEND_SETUP.md`, `DEPLOYMENT.md`, `DEPLOYMENT_STATUS.md` and `.github/WORKFLOWS.md`.
    - The whole duplicate `backend/` layer: README, guides, `docs/`, `openapi.yaml`, three workflows GitHub never ran (one wasn't valid YAML), `.gitignore`, an empty lockfile and `scripts/`.
    - Docker and nginx: both compose files, the server, client and frontend Dockerfiles, and both nginx trees.
    - `postgres-init/`, both `generate-ssl.sh` copies, `scripts/DeskSOS-Validation.ps1`, and the old CRA `frontend/`.
    - Stray files: `App (1).tsx` (empty), `App.tsx` (a Desktop component), `file-purpose-2.csv`, an empty `requirements.txt` and an empty root lockfile.
    - `restructure-desksos.ps1`, which would rename `client` to `frontend` if run again.
    - `start-backend.ps1` and `stop-backend.ps1`, replaced by start-dev and stop-dev.
  - **Dead code:** removed `src/config/database.ts` (a Postgres pool imported by nothing), the unused `pg`, `redis` and `@types/pg` packages, and a `seed` script pointing at a missing file.
  - **Updated:**
    - `backend/server/README.md`, rewritten for SQLite, PM2 and port 5100. It had described Postgres, Docker and port 5000.
    - `.env.example`, now with `TLS_CERT_PATH`, `TLS_KEY_PATH`, `SERVE_CLIENT`, `CLIENT_BUILD_PATH` and `ALLOW_HTTP_IN_PRODUCTION`.
    - The README's project structure and configuration table, and its API links.
- **Verification:**
  - `npm run typecheck` clean, 170/170 tests pass, `npm run build` succeeds.
  - `openapi.yaml` parses, with 15 operations and all 68 internal references resolving.
  - Nothing remaining references a removed file (checked by search; `backup-desksos.ps1`, still used by `stop-dev.ps1`, was kept).
  - CI uses only `backend/server` and `client`.
- **Not touched:** untracked local leftovers that git ignores and that may contain old secrets:
  - `frontend\.env` and `frontend\node_modules`
  - `backend\.env`, `backend\.env.prod`, `backend\ssl` and `backend\venv`
  - the old clones `DeskSOS-Enterprise---IT-Operations-Platform\` and `DESKSOS_Backup_20260716_075823\`

  The owner should decide whether to remove them.
- **Goal impact:** *administrators* and developers now have one accurate set of documents (README, plan, API reference, OpenAPI, server README) and no misleading Docker or Postgres instructions. Supports the Operations go-live item (accurate runbooks).

### Correction (2026-10-05)

FORD-DC01 is a **standalone Windows 11 Pro workstation in a workgroup**, not a domain controller as the original assessment assumed. There's no Active Directory, certificate authority or group policy. Decisions D1 and D4, task 5.4, task 6.6 and the first risk have been updated accordingly.
