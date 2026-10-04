# DeskSOS Enterprise - IT Operations Platform

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-green)
![React](https://img.shields.io/badge/React-18-61dafb)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003b57)
![Status](https://img.shields.io/badge/status-pre--production-orange)

Real-time incident operations dashboard for IT teams. It receives incidents from people and from DeskSOS Desktop, shows them live, and raises audible alerts for critical ones.

> **Status: pre-production.** The incident dashboard and ingest API work, but sign-in is still a placeholder and the API isn't yet protected. Don't expose it to other users or networks yet. [docs/PRODUCTION-READINESS-PLAN.md](docs/PRODUCTION-READINESS-PLAN.md) tracks the work to make it production-ready.

## ✨ What works today

- **Live incident stream:** incidents appear instantly in every open dashboard over Socket.IO (`incident:created`, `incident:updated`, `incident:locked`)
- **Incident logging:** title, description, category, severity (LOW, MEDIUM, HIGH, CRITICAL), assignee and location
- **Critical alerts:** an audible tone and a spoken announcement for CRITICAL incidents, after you click "Arm Audio"
- **Incident inspection console:** source, external ticket ID, requester, status changes and locking
- **DeskSOS Desktop bridge:** `POST /api/ingest/incidents` accepts tickets forwarded by the DeskSOS Desktop backend. It's protected by an API key and safe to retry (no duplicates)
- **Persistent storage** in SQLite (`backend/server/data/enterprise.db`)
- **Verified backups** with `backup-desksos.ps1`

**Placeholders, not production features yet:** sign-in (`/api/auth/*` accepts any credentials), user profile, dashboard metrics and team chat return sample data.

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
| `JWT_SECRET` | Token signing secret. **Set a long random value**; the built-in fallback is insecure and will be removed (plan task 1.2) | insecure fallback |
| `DATABASE_PATH` | SQLite database file | `backend/server/data/enterprise.db` |
| `INGEST_API_KEY` | Shared key DeskSOS Desktop sends as `X-API-Key`. Ingest is disabled while unset | unset |

Generate secrets with:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## 💾 Backups

```powershell
.\backup-desksos.ps1
```

This takes an online backup of the SQLite database (safe while the server runs), checks its integrity, saves it as one file in `backups\` (ignored by git), and keeps the newest 14. It doesn't back up `.env` files; keep secrets in a password manager.

## 📡 API

| Method & path | Auth | Status |
|---|---|---|
| `GET /health` | none | ✅ Checks the database; 503 if unavailable |
| `GET /api/incidents` | none ⚠️ | ✅ List incidents |
| `POST /api/incidents` | none ⚠️ | ✅ Create an incident |
| `PATCH /api/incidents/:id` | none ⚠️ | ✅ Update status |
| `POST /api/incidents/:id/lock` | none ⚠️ | ✅ Lock for a user |
| `POST /api/ingest/incidents` | `X-API-Key` | ✅ Machine-to-machine intake, idempotent on `(source, externalId)` |
| `POST /api/auth/login`, `/register`, `/logout` | none | ⚠️ Placeholder: accepts any credentials |
| `GET /api/dashboard`, `/api/dashboard/metrics` | none | ⚠️ Sample data |
| `GET /api/chat/channels`, `/api/chat/channels/:channelId/messages` | none | ⚠️ Sample data |
| `GET /api/user/me` | none | ⚠️ Sample data |

⚠️ = authentication is added in plan Phase 1. Details: [docs/API_REFERENCE.md](docs/API_REFERENCE.md) (partly outdated).

**Socket.IO events (server → client):** `incident:created`, `incident:updated`, `incident:locked`, `message:new`, `presence:update`, `user:typing`

## 🧪 Testing

```powershell
cd backend\server
npm run typecheck
npm test
```

There are no client tests yet (plan task 4.1). CI runs the backend type-check, tests and build, plus the client build, on every push and PR to `main`.

## 🔐 Security status

| Control | Status |
|---|---|
| Ingest API key (constant-time comparison) | ✅ |
| CORS restricted to the local dashboard origins | ✅ |
| Secrets kept out of git and backups | ✅ |
| User sign-in, roles, protected API and socket | ❌ Plan Phase 1 |
| Security headers, rate limiting | ❌ Plan task 1.6 |
| HTTPS | ❌ Plan task 2.3 |

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
