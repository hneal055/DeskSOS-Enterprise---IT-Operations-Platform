# DeskSOS Enterprise - IT Operations Platform

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-green)
![React](https://img.shields.io/badge/React-18-61dafb)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003b57)
![Status](https://img.shields.io/badge/status-pre--production-orange)

Real-time incident operations dashboard for IT teams. It receives incidents from people and from DeskSOS Desktop, shows them live, and raises audible alerts for critical ones.

> **Status: pre-production.** Accounts, roles and sign-in protect the API and live feed. HTTPS and a production deployment (plan Phase 2) aren't in place yet, so keep it on trusted networks. [docs/PRODUCTION-READINESS-PLAN.md](docs/PRODUCTION-READINESS-PLAN.md) tracks the work to make it production-ready.

## ✨ What works today

- **Live incident stream:** incidents appear instantly in every open dashboard over Socket.IO (`incident:created`, `incident:updated`, `incident:locked`)
- **Incident logging:** title, description, category, severity (LOW, MEDIUM, HIGH, CRITICAL), assignee and location
- **Critical alerts:** an audible tone and a spoken announcement for CRITICAL incidents, after you click "Arm Audio"
- **Incident inspection console:** source, external ticket ID, requester, status changes, locking and a **history** of who created, changed and locked each incident
- **Accounts and roles:** sign-in for every user; admin, operator and viewer roles; admins manage users in the dashboard
- **DeskSOS Desktop bridge:** `POST /api/ingest/incidents` accepts tickets forwarded by the DeskSOS Desktop backend. It's protected by an API key and safe to retry (no duplicates)
- **Persistent storage** in SQLite (`backend/server/data/enterprise.db`)
- **Verified backups** with `backup-desksos.ps1`

**Placeholders, not production features yet:** dashboard metrics and team chat return sample data (they require sign-in, but the data isn't real).

## 🚀 Quick Start (Windows development)

Requirements: Windows 10/11, Node.js 22+, PM2 (`npm install -g pm2`), PowerShell.

```powershell
git clone https://github.com/hneal055/DeskSOS-Enterprise---IT-Operations-Platform.git
cd DeskSOS-Enterprise---IT-Operations-Platform

# One-time setup
cd backend\server; npm install; Copy-Item .env.example .env; cd ..\..
cd client; npm install; cd ..

# Start (from an Administrator PowerShell window, see below)
.\start-dev.ps1
```

- Dashboard: <http://localhost:3000>
- API: <http://localhost:5100> (health check: <http://localhost:5100/health>)

### Local Development on Windows (PowerShell scripts)

Two scripts in the repo root manage a dev session: the backend runs under PM2 and the React dashboard runs on the Vite dev server (`npm start`, port 3000). The backend always loads `backend/server/.env` (and, in production, `.env.production` first). It listens on port 5100 because 5000 is used by the DESKSOS-Desktop backend.

| Script | What it does |
| ------ | ------------ |
| `start-dev.ps1` | Builds `backend/server`, (re)registers the `desksos-enterprise-backend` PM2 process, polls `http://localhost:5100/health`, then opens a PM2 log window and the React client window (<http://localhost:3000>). |
| `stop-dev.ps1` | Reverses `start-dev.ps1`. It removes `desksos-enterprise-backend` from PM2, closes the log and client windows, frees ports 5100 and 3000, sweeps orphaned PM2 daemons, and verifies the ports are free. Exits non-zero if anything is still running. |

**Clean restart of the UI dashboard:**

```powershell
.\stop-dev.ps1
.\start-dev.ps1
```

**`stop-dev.ps1` options:**

| Flag | Effect |
| ---- | ------ |
| `-DryRun` | Show what would be stopped without changing anything |
| `-Backup` | Run `backup-desksos.ps1` before tearing down |
| `-KillPm2` | Stop **all** PM2 daemons and every app they manage (full PM2 reset, also affects non-DeskSOS PM2 apps) |
| `-ClearCache` | Delete `client/node_modules/.vite` (fixes a stale dev-server cache) |
| `-Force` | Kill whatever holds ports 5100/3000, even if it doesn't look like DeskSOS |

The PM2 process name is deliberately `desksos-enterprise-backend`. The sibling `DESKSOS-Desktop` project registers its own backend as `desksos-backend` (port 5443), and sharing that name made `start-dev.ps1` restart the wrong app. Keep PM2 names unique per project.

Docker containers are never touched by these scripts.

#### Troubleshooting: `connect EPERM \\.\pipe\rpc.sock`

On Windows, PM2 communicates through the named pipe `\\.\pipe\rpc.sock`. If the PM2 daemon was started from an **elevated** ("Run as administrator") terminal, a non-elevated terminal can't connect to it. Each failed `pm2` call then starts a new daemon that also can't take the pipe, and these orphans pile up.

- Run `start-dev.ps1` and `stop-dev.ps1` from a terminal with the **same elevation** as the one that first started PM2. Pick one, always elevated or never, and stick with it. VS Code's Code Runner is never elevated.
- Both scripts detect this situation and exit with guidance instead of calling `pm2`.
- `stop-dev.ps1` removes orphaned daemons automatically. To start completely fresh, run `.\stop-dev.ps1 -KillPm2` from an elevated terminal.

### Production deployment

> **Running production day to day?** Use the runbook, [docs/OPERATIONS.md](docs/OPERATIONS.md). It covers daily checks, upgrades and rollback, backup and restore (with a restore drill), accounts, secrets, certificates and troubleshooting. This section is the setup reference. **Dashboard users** (operators and viewers): see the [user guide](docs/USER-GUIDE.md).

Production runs alongside development on the same PC, under its own PM2 name, port and database:

| | Development | Production |
|---|---|---|
| Address | http://localhost:3000 (Vite) + :5100 (API) | **https://FORD-DC01:5543** (dashboard and API on one port) |
| PM2 name | `desksos-enterprise-backend` | `desksos-enterprise` |
| Database | `backend/server/data/enterprise.db` | `backend/server/data/enterprise-prod.db` |
| Secrets | `backend/server/.env` | `backend/server/.env.production` (its own `JWT_SECRET` and `INGEST_API_KEY`) |

**Keep the server awake.** Windows 11 puts the PC to sleep after a few idle minutes, which takes production off the network (seen 2026-10-06). Once, from an Administrator window:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

**Firewall:** if Windows has ever shown a "Node.js wants to access the network" prompt, its "Node.js JavaScript Runtime" rules allow every Node port from any address, which overrides the LAN-only rule below. Limit them:

```powershell
Get-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' | Set-NetFirewallRule -EdgeTraversalPolicy Block -RemoteAddress LocalSubnet
```

The production scripts need **PowerShell 7**. From a Windows PowerShell 5.1 window, run them through it, e.g. `& "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -File C:\Projects\DESKSOS\start-production.ps1 -SkipBuild`.

**Start or restart production** from an Administrator **PowerShell 7** window:

```powershell
.\start-production.ps1            # build, then (re)start and check health
.\start-production.ps1 -SkipBuild # restart the existing build
```

The script:

1. checks that PM2 is reachable from the window
2. creates `.env.production` with fresh secrets if it's missing (never printed)
3. creates the HTTPS certificate if it's missing, and warns when it's near expiry
4. builds the backend and dashboard
5. replaces any previous production instance
6. starts it with `backend/server/ecosystem.config.js` and saves PM2's process list
7. waits for `/health` over HTTPS

Running it again is harmless. On the first start of the production database, it shows how to read the one-time admin password from the log.

Other commands: `pm2 status`, `pm2 logs desksos-enterprise`, `pm2 stop desksos-enterprise`.

**Reset a production account:**

```powershell
cd backend\server
$env:DATABASE_PATH = 'data\enterprise-prod.db'
npm run user:reset-password -- admin@desksos.local
```

**Restart on boot, nightly backup, health monitor and firewall**, from an Administrator PowerShell 7 window:

```powershell
.\register-production-tasks.ps1 -DryRun   # preview (no admin needed)
.\register-production-tasks.ps1           # register or update
.\register-production-tasks.ps1 -Unregister
```

| What | Schedule | Details |
|---|---|---|
| `DeskSOS Enterprise Startup` | at boot + 3 min | `start-production.ps1 -SkipBuild`. Waits until DeskSOS Desktop's startup task (+1 min) has run, because two PM2 commands at once can each spawn a daemon |
| `DeskSOS Enterprise Daily Backup` | daily 02:30 | Verified backup of `enterprise-prod.db` into `backups\production` (14 kept). Fails loudly if the database disappears while backups exist |
| `DeskSOS Enterprise Health Monitor` | every 5 min | Checks `https://localhost:5543/health` with normal certificate validation. Alerts once on DOWN and once on recovery, and warns daily before the certificate expires (14 days) |
| Firewall `DeskSOS Enterprise (HTTPS 5543, LAN only)` | n/a | Inbound TCP 5543 from the **local subnet only**, under every network profile |

The tasks run as the current user whether or not anyone is signed in, using the MSI install of PowerShell 7. The script refuses to use the Microsoft Store version, which can't run in such tasks. Logs are in `backend\server\logs\` (`startup.log`, `backup.log`, `monitor.log`).

**Alerts** go to a Teams channel and/or email. Set these as user-level environment variables, then run the register script again:

```powershell
[Environment]::SetEnvironmentVariable('ALERT_TEAMS_WEBHOOK_URL', '<incoming webhook or Workflows URL>', 'User')
# optional email: ALERT_SMTP_HOST, ALERT_SMTP_PORT, ALERT_SMTP_USER, ALERT_SMTP_PASS, ALERT_TO
```

Without them, alerts are only written to `monitor.log`.

The earlier Docker Compose files were removed because they no longer matched the application.

## 🏗️ Architecture

```
┌──────────────────────┐   HTTP + Socket.IO    ┌──────────────────────────┐
│  React dashboard     │◄─────────────────────►│  Express API (port 5100) │
│  (dev server :3000,  │   /api proxied to     │  - REST /api/*           │
│   proxies to :5100)  │   the API             │  - Socket.IO events      │
└──────────────────────┘                       │  - /health               │
                                               └─────┬───────────────▲────┘
                                                     │               │ POST /api/ingest/incidents
                                          better-sqlite3             │ (X-API-Key)
                                                     │               │
                                       ┌─────────────▼──┐   ┌────────┴──────────────┐
                                       │ SQLite          │   │ DeskSOS Desktop       │
                                       │ enterprise.db   │   │ backend (bridge)      │
                                       └─────────────────┘   └───────────────────────┘
```

## 🛠️ Technology Stack

- **Backend:** Node.js 22+, Express 4, TypeScript, Socket.IO 4, better-sqlite3, jsonwebtoken
- **Frontend:** React 18 built with Vite, Socket.IO client, Tailwind CSS 3 (compiled at build time)
- **Process management:** PM2
- **Tests and CI:** Jest and supertest (backend), GitHub Actions

## 📦 Project Structure

```
DESKSOS/
├── backend/server/             # Express API (TypeScript)
│   ├── src/
│   │   ├── routes/             # auth, incidents, adminUsers, ingest (+ sample dashboard, chat, user)
│   │   ├── middleware/         # auth, apiKey, validate, security, requestLog
│   │   ├── services/socket.ts  # Socket.IO events
│   │   ├── config/index.ts     # Loads .env (and .env.production in production)
│   │   ├── db.ts               # SQLite schema and queries
│   │   └── index.ts            # Entry point
│   ├── scripts/                # backup-db.js, backup-prod.ps1, gen-cert.ps1, monitor-health.ps1, reset-password.js
│   ├── ecosystem.config.js     # PM2 production settings
│   ├── tests/                  # Jest + supertest
│   └── .env.example
├── client/                     # React dashboard (Vite)
├── docs/                       # Readiness plan and API reference
├── openapi.yaml                # Machine-readable API description
├── start-dev.ps1 / stop-dev.ps1        # Dev session start / teardown
├── start-production.ps1 / register-production-tasks.ps1  # Production start; boot, backup and monitor tasks
├── rotate-ingest-key.ps1       # Pair or rotate the Desktop ingest key (-Production)
└── backup-desksos.ps1          # Database backup
```

## 🔧 Configuration

Copy `backend/server/.env.example` to `backend/server/.env`. That file is ignored by git.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | `5100` |
| `NODE_ENV` | `development` or `production` | `development` |
| `JWT_SECRET` | Token signing secret. **Required**: at least 32 characters, not a placeholder; the server refuses to start otherwise | none |
| `DATABASE_PATH` | SQLite database file (incidents, users, history) | `backend/server/data/enterprise.db` |
| `INGEST_API_KEY` | Shared key DeskSOS Desktop sends as `X-API-Key`. Ingest is disabled while unset | unset |
| `CORS_ORIGINS` | Browser origins allowed to use the API and socket (comma-separated) | `http://localhost:3000,http://localhost:3001` |
| `RATE_LIMIT_API` / `_LOGIN` / `_INGEST` | Requests per IP per 15 minutes (sign-in: failed attempts per IP + email) | `600` / `10` / `2000` |
| `LOG_LEVEL` | winston log level | `info` in production, `debug` otherwise |
| `SERVE_CLIENT` | Serve the built dashboard (`client/build`) from this server | `true` in production, otherwise `false` |
| `CLIENT_BUILD_PATH` | Where the built dashboard is | `client/build` |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | HTTPS certificate and key (PEM, relative to `backend/server`). Both or neither; **required in production** | unset (HTTP) |
| `ALLOW_HTTP_IN_PRODUCTION` | `true` only if a TLS proxy sits in front of the server | unset |

In production (`NODE_ENV=production`), `backend/server/.env.production` is loaded first and wins over `.env`. Production must have its **own** `JWT_SECRET` (and ingest key), so tokens from the development server don't work on production.

> If a Windows user environment variable named `JWT_SECRET` exists, it overrides `.env`. Remove it (or start from a terminal that doesn't have it), or the server may refuse to start.

Generate secrets with:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## 💾 Backups

```powershell
.\backup-desksos.ps1
```

This takes an online backup of the SQLite database (safe while the server runs), checks its integrity, saves it as one file in `backups\` (ignored by git), and keeps the newest 14. It doesn't back up `.env` files; keep secrets in a password manager.

## 👥 Accounts

- **First start:** the server creates `admin@desksos.local` with a random password, printed once in the startup output (and in PM2's log). Sign in and choose your own password right away; nothing else works until you do.
- **Adding people:** admins use **Users** in the dashboard header. Each new user gets a temporary password, shown once, which they replace at first sign-in. Roles:
  - **admin:** everything, including managing users
  - **operator:** create, update and lock incidents
  - **viewer:** read-only
- **Leavers:** deactivate them in **Users**. Their sessions end immediately, including any dashboard they have open.
- **Your own password:** use **Change password** in the header. Your other sessions are signed out. Admins can't reset their own password from **Users**.
- **Locked out of every admin account?** On the server:

  ```powershell
  cd backend\server
  npm run build
  npm run user:reset-password -- --list
  npm run user:reset-password -- admin@desksos.local
  ```

  This prints a temporary password, reactivates the account if needed, and ends that account's sessions.

## 🔒 HTTPS

Certificates come from this PC's [mkcert](https://github.com/FiloSottile/mkcert) certificate authority, the same one DeskSOS Desktop uses:

```powershell
pwsh backend\server\scripts\gen-cert.ps1
```

This creates `backend\server\certs\server.crt` and `server.key` for `localhost`, `127.0.0.1`, the computer name and its LAN address (all ignored by git), plus `desksos-ca.crt`, the authority's **public** certificate. Browsers on this PC trust the site straight away.

**Each other PC that opens the dashboard must trust the authority once.** Without a Windows domain there's no group policy to do it automatically. On each PC, in an Administrator PowerShell window:

```powershell
Import-Certificate -FilePath \\FORD-DC01\path\to\desksos-ca.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Chrome and Edge then trust it. Firefox uses its own store: in `about:config`, set `security.enterprise_roots.enabled` to `true`.

Keep mkcert's private key (`rootCA-key.pem` in `mkcert -CAROOT`) on this PC only. Anyone holding it can create certificates those PCs would trust.

**Node.js programs** that call the server over HTTPS, such as the Desktop bridge, don't use the Windows certificate store. Point them at the authority with `NODE_EXTRA_CA_CERTS=<path>\desksos-ca.crt`.

## 🔑 Rotating the ingest key

The DeskSOS Desktop bridge authenticates to `POST /api/ingest/incidents` with a key shared by both projects. To replace it, for example if it may have been exposed:

```powershell
.\rotate-ingest-key.ps1
```

The script:

- writes a new random key to `backend\server\.env` (`INGEST_API_KEY`) and to Desktop's `backend\.env` (`ENTERPRISE_INGEST_KEY`; default path `C:\Projects\DESKSOS-Desktop\backend\.env`, override with `-DesktopEnv`)
- checks that both files hold the same new key
- never prints the key

Then restart **both** backends. Tickets created on Desktop while only one side has restarted are refused with a 401, stay queued in Desktop's outbox, and are delivered automatically once both use the new key. Nothing is lost.

**Production pair:** `.\rotate-ingest-key.ps1 -Production` does the same for `backend\server\.env.production` (`INGEST_API_KEY`) and Desktop's `backend\.env.production` (`ENTERPRISE_INGEST_KEY`), creating Desktop's file if it doesn't exist. This is also how the production bridge is first connected. Then restart both:

```powershell
.\start-production.ps1 -SkipBuild
C:\Projects\DESKSOS-Desktop\backend\scripts\start-production.ps1 -SkipBuild
```

Desktop production already points at `https://localhost:5543` and trusts the mkcert CA through `NODE_EXTRA_CA_CERTS` (its `ecosystem.config.js`).

## 📡 API

Signed-in requests send `Authorization: Bearer <token>`. Tokens last 8 hours and stop working immediately after a password change, role change or deactivation.

| Method & path | Who can use it | Purpose |
|---|---|---|
| `GET /health` | anyone | Checks the database; 503 if unavailable |
| `POST /api/auth/login` | anyone (rate limited) | Returns a token and the user |
| `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout` | signed in | Current user; change own password (allowed while a change is pending) |
| `GET /api/incidents`, `GET /api/incidents/:id/history` | any role | List incidents; an incident's history |
| `POST /api/incidents`, `PATCH /api/incidents/:id`, `POST /api/incidents/:id/lock` | operator, admin | Create, change status (`Open`, `In Progress`, `Resolved`), lock in your name |
| `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password` | admin | Manage users |
| `POST /api/ingest/incidents` | `X-API-Key` | Desktop intake, idempotent on `(source, externalId)` |
| `GET /api/dashboard`, `/api/chat/*`, `/api/user/me` | any role | Sample data (placeholders) |

Invalid input returns `400 { error, details[] }`. Full details, with request and response examples: [docs/API_REFERENCE.md](docs/API_REFERENCE.md); machine-readable: [openapi.yaml](openapi.yaml).

**Socket.IO:** connect with `auth: { token }`; connections without a valid token are refused. Events (server → client): `incident:created`, `incident:updated`, `incident:locked`, `message:new`, `presence:update`, `user:typing`.

## 🧪 Testing

```powershell
cd backend\server
npm run typecheck
npm test
```

The backend suite covers sign-in, roles, an access matrix over every protected route, the socket, rate limits, validation, user management and the audit trail. There are no automated client tests yet (plan task 4.1). CI runs the backend type-check, tests and build, plus the client build, on every push and PR to `main`.

## 🔐 Security status

| Control | Status |
|---|---|
| Ingest API key (constant-time comparison), rotation script | ✅ |
| User accounts (scrypt hashes), roles, sign-in on every API route and the socket | ✅ |
| Strong `JWT_SECRET` required; 8-hour tokens revoked on password, role or status change | ✅ |
| Security headers, rate limiting (incl. sign-in brute force), 100 KB body cap | ✅ |
| Input validation on every write route | ✅ |
| Incident audit trail; security audit log (sign-ins, password changes, user management) | ✅ |
| CORS restricted to configured origins | ✅ |
| Secrets kept out of git and backups; production has its own secrets | ✅ |
| HTTPS (required in production), HSTS, strict Content-Security-Policy | ✅ |
| Production deployment: served build, start script | ✅ |
| Restart on boot, LAN-only firewall rule | ❌ Plan tasks 2.5 and 2.6 (admin steps) |

## 📜 Logs

The server logs through winston to its standard output; PM2 writes that to its log files and the `pm2-logrotate` module rotates them daily, keeping 14 days, compressed.

- **Production:** one JSON object per line at `info` level and above. Entries have a `type`:
  - `request`: method, path (no query string), status, duration, user, IP
  - `audit`: `auth.login`, `auth.login_failed`, `auth.password_changed`, `user.created`, `user.updated` (with from → to), `user.password_reset`
  - `startup`
- **Development:** short readable lines at `debug` level.
- **Never logged:** passwords, temporary passwords, tokens, API keys. The one exception is the very first start of a new database, which prints the initial admin password to the PM2 log so it can be read once. It stops working when it's changed at first sign-in.

```powershell
pm2 logs desksos-enterprise                      # live
Select-String backend\server\logs\pm2-out*.log -Pattern '"type":"audit"'   # security events
```

## 🤝 Contributing

1. Create a feature branch (`git checkout -b feature/NewFeature`)
2. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
3. Push and open a pull request into `main`; CI must pass

## 📝 License

This project is proprietary software for internal use only.

**© 2026 DeskSOS Team. All rights reserved.**

## 🐛 Bug Reports & Feature Requests

- **GitHub Issues:** [Open an issue](https://github.com/hneal055/DeskSOS-Enterprise---IT-Operations-Platform/issues)
- **Email:** support@desksos.com

Please include a clear description, steps to reproduce, expected and actual behavior, screenshots or logs, and your environment (OS, Node.js version, browser).
