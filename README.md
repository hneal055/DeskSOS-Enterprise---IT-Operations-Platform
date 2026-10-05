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

Two scripts in the repo root manage a dev session: the backend runs under PM2 and the React client runs with `npm start`. The backend always loads `backend/server/.env` (not the repo-root `.env`, which belongs to a different stack). It listens on port 5100 because 5000 is used by the DESKSOS-Desktop backend.

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
| `-ClearCache` | Delete `client/node_modules/.cache` (fixes stale React builds) |
| `-Force` | Kill whatever holds ports 5100/3000, even if it doesn't look like DeskSOS |

The PM2 process name is deliberately `desksos-enterprise-backend`. The sibling `DESKSOS-Desktop` project registers its own backend as `desksos-backend` (port 5443), and sharing that name made `start-dev.ps1` restart the wrong app. Keep PM2 names unique per project.

Docker containers are never touched by these scripts.

#### Troubleshooting: `connect EPERM \\.\pipe\rpc.sock`

On Windows, PM2 communicates through the named pipe `\\.\pipe\rpc.sock`. If the PM2 daemon was started from an **elevated** ("Run as administrator") terminal, a non-elevated terminal can't connect to it. Each failed `pm2` call then starts a new daemon that also can't take the pipe, and these orphans pile up.

- Run `start-dev.ps1` and `stop-dev.ps1` from a terminal with the **same elevation** as the one that first started PM2. Pick one, always elevated or never, and stick with it. VS Code's Code Runner is never elevated.
- Both scripts detect this situation and exit with guidance instead of calling `pm2`.
- `stop-dev.ps1` removes orphaned daemons automatically. To start completely fresh, run `.\stop-dev.ps1 -KillPm2` from an elevated terminal.

### Production deployment

Not supported yet. Production setup (HTTPS, a production build of the dashboard served by the backend, restart on boot, monitoring) is Phase 2 of the [readiness plan](docs/PRODUCTION-READINESS-PLAN.md). The earlier Docker Compose files were removed because they no longer matched the application.

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
- **Frontend:** React 18 (Create React App), Socket.IO client, Tailwind (CDN in development)
- **Process management:** PM2
- **Tests and CI:** Jest and supertest (backend), GitHub Actions

## 📦 Project Structure

```
DESKSOS/
├── backend/server/             # Express API (TypeScript)
│   ├── src/
│   │   ├── routes/             # incidents, ingest, auth, dashboard, chat, user
│   │   ├── middleware/         # apiKey (ingest auth)
│   │   ├── services/socket.ts  # Socket.IO events
│   │   ├── config/index.ts     # Loads backend/server/.env
│   │   ├── db.ts               # SQLite schema and queries
│   │   └── index.ts            # Entry point
│   ├── scripts/backup-db.js    # Verified online backup
│   ├── tests/                  # Jest + supertest
│   └── .env.example
├── client/                     # React dashboard (Create React App)
├── docs/                       # Plans and API reference
├── start-dev.ps1 / stop-dev.ps1        # Dev session start / teardown
├── start-backend.ps1 / stop-backend.ps1
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
- **Leavers:** deactivate them in **Users**. Their sessions end immediately.
- **Locked out of every admin account?** On the server:

  ```powershell
  cd backend\server
  npm run build
  npm run user:reset-password -- --list
  npm run user:reset-password -- admin@desksos.local
  ```

  This prints a temporary password, reactivates the account if needed, and ends that account's sessions.

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

Invalid input returns `400 { error, details[] }`. Details: [docs/API_REFERENCE.md](docs/API_REFERENCE.md) (outdated).

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
| Incident audit trail | ✅ |
| CORS restricted to configured origins | ✅ |
| Secrets kept out of git and backups | ✅ |
| HTTPS | ❌ Plan task 2.3 |
| Production deployment (served build, restart on boot) | ❌ Plan Phase 2 |

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
