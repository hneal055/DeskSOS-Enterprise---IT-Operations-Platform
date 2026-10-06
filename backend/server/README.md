# DeskSOS Enterprise: backend server

This is the Express + TypeScript API behind the DeskSOS Enterprise dashboard. Incidents, users and history are stored in **SQLite** (better-sqlite3), and live updates go over **Socket.IO**.

The [root README](../../README.md) is the main guide, covering setup, production, accounts, HTTPS and backups. The API is described in [docs/API_REFERENCE.md](../../docs/API_REFERENCE.md). This file covers working on the server itself.

## Run it

Normally you start everything from the repository root with `.\start-dev.ps1`, in an Administrator window. That runs this server under PM2 as `desksos-enterprise-backend` on **port 5100**, and the dashboard on port 3000.

To run the server on its own:

```powershell
cd backend\server
npm ci
copy .env.example .env      # then set JWT_SECRET (see the comments in the file)
npm run dev                 # nodemon + ts-node, http://localhost:5100
```

The first start creates `data/enterprise.db` and an admin account, `admin@desksos.local`. The one-time password is printed to the console.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server with reload |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run `dist/index.js` |
| `npm test` | Jest + supertest (in-memory databases; doesn't touch `data/`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run user:reset-password -- <email>` | New temporary password for an account; `--list` shows accounts. Set `DATABASE_PATH` for production |

**Operations scripts** in `scripts/`:

| Script | What it does |
|---|---|
| `backup-db.js` | Verified online backup |
| `backup-prod.ps1` | Nightly production backup task |
| `gen-cert.ps1` | HTTPS certificate from the local CA |
| `monitor-health.ps1` | 5-minute health check and alerts |
| `reset-password.js` | Account recovery (the npm script above) |

## Layout

```
src/
  index.ts            entry point: middleware, routes, Socket.IO, static dashboard
  config/index.ts     settings from .env (and .env.production in production); refuses weak secrets
  db.ts               SQLite schema and incident queries
  users.ts            accounts, password hashing, token versions
  audit.ts            incident history (incident_events)
  logger.ts           winston: JSON logs, request log, security audit log
  validation.ts       zod schemas for request bodies and params
  static.ts           serves client/build in production
  middleware/         auth (JWT + roles), apiKey (ingest), validate, security (helmet, rate limits), requestLog
  routes/             auth, incidents, adminUsers, ingest; dashboard, chat, user return sample data
  services/socket.ts  Socket.IO authentication and events
tests/                Jest suites, including the route-discovery "no open endpoints" gate
```

## Configuration

All settings are documented in [`.env.example`](.env.example) and in the root README's "Configuration" table. Production settings come from `ecosystem.config.js` (`env_production`) and the secrets file `.env.production`, which `start-production.ps1` creates.
