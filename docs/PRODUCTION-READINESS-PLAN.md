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

## 4. Decisions needed before Phase 2

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | How do Enterprise users sign in? | (a) Local accounts in Enterprise, (b) Active Directory / LDAP, (c) Microsoft Entra ID SSO | **(a) now, (b) later.** Local accounts with roles unblock go-live. FORD-DC01 is a domain controller, so AD sign-in is a natural Phase 6 upgrade |
| D2 | Enterprise roles | Admin / Operator / Viewer, or Admin / Operator | **Admin, Operator, Viewer.** Viewer suits wall-screen dashboards and managers |
| D3 | Who can reach Enterprise? | This server only, the office LAN, or the internet | **Office LAN only**, through a firewall rule scoped to the LAN. No internet exposure without a reverse proxy and a further review |
| D4 | Code-signing certificate for the Desktop installer | Public CA (OV/EV) or internal AD CS | **Internal AD CS** if every client PC is domain-joined, since FORD-DC01 can issue it. A public CA otherwise |
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
| 5.4 | **Pilot rollout:** deploy by GPO to 3–5 PCs, collect feedback, then roll out to everyone | Admin, Owner | M | The pilot runs a week with no blocking issues |

### Phase 6: User readiness and go-live (week 5–6)

| # | Task | Owner | Size | Done when |
|---|---|---|---|---|
| 6.1 | **User guides:** a technician quick-start (Desktop) and an operator and viewer guide (Enterprise dashboard) | Dev, Owner | M | Published where staff can find them |
| 6.2 | **Administrator guide:** accounts and roles, onboarding and offboarding, key rotation, backups and restore, upgrades | Dev | S | Part of the two runbooks |
| 6.3 | **User acceptance testing:** scripted scenarios run by 2–3 real users per product, including a ticket flowing from Desktop to the Enterprise dashboard | Owner | M | All scenarios pass; issues are triaged |
| 6.4 | **Support process:** who users contact, how incidents in DeskSOS itself are handled, response targets | Owner | S | Documented and communicated |
| 6.5 | **Go-live,** using the checklist in section 6 | Owner, Admin | S | Signed off |
| 6.6 | *(Later)* Active Directory sign-in for Enterprise (decision D1-b), and syncing Desktop status changes to Enterprise | Dev | L | Separate project after go-live |

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
| Both products and their backups are on one server, a domain controller | Server or disk loss takes everything down; a compromise of DeskSOS sits on a DC | Off-machine backups (3.2). In the longer term, move DeskSOS to a member server instead of the DC |
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
