# DeskSOS Enterprise API reference

This is the HTTP and Socket.IO API of the DeskSOS Enterprise backend (`backend/server`). Everything here is taken from the code. If the two disagree, the code is right and this file needs fixing.

The machine-readable version is [`openapi.yaml`](../openapi.yaml) at the repository root.

## Base URLs

| Environment | Base URL | Notes |
|---|---|---|
| Production | `https://FORD-DC01:5543` | HTTPS, office LAN only. The same port also serves the dashboard |
| Development | `http://localhost:5100` | The Vite dashboard on `:3000` proxies `/api` and `/socket.io` here |

Paths have no version prefix. Every API path starts with `/api`, except `/health`.

Production uses a certificate from the local CA (see the README, "HTTPS"). Clients must trust that CA. Windows `curl.exe` also needs `--ssl-no-revoke`, because the local CA has no revocation list.

## Authentication

There are two ways to authenticate:

| Who | How | Used by |
|---|---|---|
| People | `Authorization: Bearer <token>`, from `POST /api/auth/login` | The dashboard, and scripts acting as a user |
| Machines | `X-API-Key: <INGEST_API_KEY>` | `POST /api/ingest/incidents` only (the DeskSOS Desktop bridge) |

**Tokens:**

- They are JWTs (HS256) and last **8 hours**.
- They stop working **immediately** when the user's password is changed or reset, their role changes, or they're deactivated. Each token carries the user's token version, and the server checks it on every request.
- Logout is client-side: discard the token. `POST /api/auth/logout` exists for symmetry and returns 204.

**First sign-in.** New and reset accounts have a temporary password, and `mustChangePassword: true`. Until the password is changed, every endpoint returns `403 { "error": "Password change required", "code": "PASSWORD_CHANGE_REQUIRED" }`, except `GET /api/auth/me` and `POST /api/auth/change-password`.

### Roles

| Role | Can |
|---|---|
| `viewer` | Read incidents and their history |
| `operator` | Everything a viewer can, plus create incidents, change their status and lock them |
| `admin` | Everything an operator can, plus manage users |

## Endpoints at a glance

| Method and path | Access | Purpose |
|---|---|---|
| `GET /health` | Public | Liveness and database check |
| `GET /api` | Public | Server name and a short endpoint list |
| `POST /api/auth/login` | Public (rate limited) | Sign in; returns a token |
| `GET /api/auth/me` | Signed in (a password change may be pending) | Current user |
| `POST /api/auth/change-password` | Signed in (a password change may be pending) | Change your own password; returns a new token |
| `POST /api/auth/logout` | Public | No-op; returns 204 |
| `GET /api/incidents` | Any role | List incidents |
| `POST /api/incidents` | operator, admin | Create an incident |
| `PATCH /api/incidents/:id` | operator, admin | Change an incident's status |
| `POST /api/incidents/:id/lock` | operator, admin | Lock an incident to yourself |
| `GET /api/incidents/:id/history` | Any role | An incident's audit trail |
| `GET /api/admin/users` | admin | List users |
| `POST /api/admin/users` | admin | Create a user; returns a temporary password |
| `PATCH /api/admin/users/:id` | admin | Change name, role or active state |
| `POST /api/admin/users/:id/reset-password` | admin | Issue a new temporary password |
| `POST /api/ingest/incidents` | `X-API-Key` | Machine intake (idempotent) |
| `GET /api/user/me` | Any role | Current user (older shape) |
| `GET /api/dashboard`, `GET /api/dashboard/metrics` | Any role | **Sample data** (placeholder) |
| `GET /api/chat/channels`, `GET /api/chat/channels/:channelId/messages` | Any role | **Sample data** (placeholder) |

---

## Health

### `GET /health`

No authentication. It checks that the database answers.

```json
200 { "status": "ok", "timestamp": "2026-10-06T11:49:37.296Z", "services": { "database": "connected" } }
503 { "status": "error", "timestamp": "…", "services": { "database": "unavailable" } }
```

The health monitor task and `start-production.ps1` both use this endpoint.

---

## Auth

### `POST /api/auth/login`

```json
{ "email": "admin@desksos.local", "password": "…" }
```

**Response 200:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs…",
  "user": { "id": 1, "email": "admin@desksos.local", "name": "Administrator", "role": "admin", "mustChangePassword": false }
}
```

| Status | Meaning |
|---|---|
| 400 | Missing email or password (validation) |
| 401 | `Invalid email or password`. The same response covers an unknown email, a wrong password and a deactivated account |
| 429 | Too many **failed** attempts for this IP and email (10 per 15 minutes) |

Successful and failed sign-ins are written to the audit log (`auth.login`, `auth.login_failed`).

### `GET /api/auth/me`

Returns the `user` object above. It works while a password change is pending, so the dashboard can show the change-password screen.

### `POST /api/auth/change-password`

```json
{ "currentPassword": "…", "newPassword": "at least 12 characters" }
```

**Response 200:** `{ "token": "<new token>", "user": { … } }`. Store the new token, because every earlier token for this user stops working. The user's other open live connections are closed and reconnect with their own tokens. Those are rejected if the tokens are old.

| Status | Meaning |
|---|---|
| 400 | New password under 12 or over 256 characters, or the same as the current one |
| 401 | `Current password is incorrect` |

### `POST /api/auth/logout`

Returns 204. Tokens are stateless, so the client simply discards its token.

---

## Incidents

### The incident object

```json
{
  "id": 42,
  "title": "PC keeps shutting down and powering up",
  "description": "…",
  "category": "Desktop Support",
  "severity": "CRITICAL",
  "status": "Open",
  "location": { "latitude": 34.0522, "longitude": -118.2437 },
  "assignedTo": "Node-Ops-Lead",
  "source": "desksos-desktop-prod",
  "externalId": "T-12345678",
  "requester": "Administrator",
  "created_at": "2026-10-06T14:23:27.000Z",
  "updated_at": "2026-10-06T14:23:27.000Z"
}
```

| Field | Values |
|---|---|
| `severity` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` |
| `status` | `Open`, `In Progress`, `Resolved` |
| `source` | `enterprise-ui` for incidents created in the dashboard, or the integration's `source` for ingested ones |
| `externalId`, `requester` | Set for ingested incidents; `null` otherwise |
| `lockedBy` | Present only in list responses, while someone holds the lock |

### `GET /api/incidents`

Returns an array of the 500 newest incidents, newest first.

### `POST /api/incidents` (operator, admin)

```json
{
  "title": "Memory leak detected on worker cluster",
  "description": "Diagnostic details…",
  "category": "Infrastructure",
  "severity": "CRITICAL",
  "status": "Open",
  "assignedTo": "Node-Ops-Lead",
  "location": { "latitude": 34.0522, "longitude": -118.2437 }
}
```

| Field | Rules | Default |
|---|---|---|
| `title` | Required, 1–255 characters | |
| `description` | Required, 1–20,000 characters | |
| `category` | Optional, up to 100 characters | `Infrastructure` |
| `severity` | Optional, one of the severities | `MEDIUM` |
| `status` | Optional, one of the statuses | `Open` |
| `assignedTo` | Optional, up to 100 characters | `Unassigned` |
| `location.latitude` / `location.longitude` | Optional, −90…90 / −180…180. `null` counts as not provided | |

Strings are trimmed and unknown fields are dropped. The response is **201** with the incident. The server also emits `incident:created` to every connected dashboard, and a `CRITICAL` incident triggers the dashboard alarm.

### `PATCH /api/incidents/:id` (operator, admin)

The only field that can change is the status:

```json
{ "status": "Resolved" }
```

Returns **200** with the updated incident and emits `incident:updated`. Setting the status to `Resolved` releases any lock. A real change is recorded in the history; setting the same status again isn't. If the incident doesn't exist, the response is **404**.

### `POST /api/incidents/:id/lock` (operator, admin)

Locks the incident to the **signed-in user**. The holder's name comes from the token and can't be supplied by the client. There is no request body.

```json
200 { "success": true, "lockedBy": "Administrator" }
409 { "error": "Incident is currently locked by Jane Doe" }
```

Emits `incident:locked`. Locks are held in memory, so they clear when the server restarts. A lock is released when the incident is resolved.

### `GET /api/incidents/:id/history`

Returns the incident's audit trail, oldest first:

```json
[
  { "id": 1, "incidentId": 42, "action": "ingested",
    "actor": { "userId": null, "name": "desksos-desktop-prod", "type": "integration" },
    "details": { "externalId": "T-12345678", "requester": "Administrator", "severity": "CRITICAL" },
    "createdAt": "2026-10-06T14:23:27.000Z" },
  { "id": 2, "incidentId": 42, "action": "status_changed",
    "actor": { "userId": 1, "name": "Administrator", "type": "user" },
    "details": { "from": "Open", "to": "Resolved" },
    "createdAt": "…" }
]
```

`action` is one of `created`, `ingested`, `status_changed`, `locked`.

---

## User administration (admin)

Admins never choose users' passwords. The server generates a temporary one, returns it **once**, and the user must change it at first sign-in. **Enterprise doesn't send email**, so the admin passes the password on themselves.

### The admin user object

```json
{ "id": 2, "email": "jane@example.com", "name": "Jane Doe", "role": "operator", "active": true,
  "mustChangePassword": true, "createdAt": "…", "lastLoginAt": null }
```

### `GET /api/admin/users`

Returns an array of all users: active ones first, then by name.

### `POST /api/admin/users`

```json
{ "email": "jane@example.com", "name": "Jane Doe", "role": "operator" }
```

The email is lowercased and must be valid. The name can be 1–100 characters, and the role is `admin`, `operator` or `viewer`.

```json
201 { "user": { … }, "temporaryPassword": "Xk7-…" }
409 { "error": "A user with this email already exists" }
```

### `PATCH /api/admin/users/:id`

Send at least one of these fields:

```json
{ "name": "Jane Smith", "role": "viewer", "active": false }
```

There's no delete: **deactivate** a user with `active: false` instead. A role change or deactivation revokes the user's tokens and closes their live connections. Returns **200** with the user.

| Status | Meaning |
|---|---|
| 400 | Deactivating yourself, removing your own admin role, or leaving no active admin |
| 404 | User not found |

### `POST /api/admin/users/:id/reset-password`

Issues a new temporary password, revokes the user's tokens and closes their connections. It also sets `mustChangePassword`.

```json
200 { "user": { … }, "temporaryPassword": "…" }
```

You can't reset your own password this way (**400**); use change-password instead. If every admin is locked out, reset from the server with `npm run user:reset-password` (see the README, "Accounts").

---

## Ingest (machine to machine)

### `POST /api/ingest/incidents`

This is how other systems, mainly the DeskSOS Desktop bridge, create incidents.

- **Authentication:** the `X-API-Key` header must equal the server's `INGEST_API_KEY`, compared in constant time. Pair and rotate keys with `rotate-ingest-key.ps1`.
- **Idempotency:** it's idempotent on `(source, externalId)`. A retry returns the existing incident with **200** instead of creating a duplicate, so senders can retry safely.

```json
{
  "source": "desksos-desktop-prod",
  "externalId": "T-12345678",
  "title": "User unable to connect to network",
  "description": "Diagnostic report…",
  "severity": "CRITICAL",
  "category": "Desktop Support",
  "requester": "Administrator",
  "assignedTo": "Sarah K.",
  "location": { "latitude": 34.05, "longitude": -118.24 }
}
```

| Field | Rules |
|---|---|
| `source`, `externalId` | Required, trimmed, up to 200 characters |
| `title` | Required, trimmed, up to 255 characters (longer text is cut) |
| `description` | Required, trimmed, up to 20,000 characters (longer text is cut) |
| `severity` | Optional, one of the severities (default `MEDIUM`) |
| `category` | Optional (default `Desktop Support`) |
| `requester`, `assignedTo` | Optional, up to 200 characters |
| `location` | Optional; values that aren't numbers are ignored |

| Status | Meaning |
|---|---|
| 201 | Created; also emits `incident:created` (the alarm, if `CRITICAL`) and records an `ingested` history event |
| 200 | Already received; returns the existing incident |
| 400 | `{ "error": "Validation failed", "details": [ … ] }` |
| 401 | `Invalid or missing API key` |
| 429 | Over the ingest limit. The Desktop bridge retries |
| 503 | `INGEST_API_KEY` isn't set, so ingest is off |

Desktop maps its priorities to severities like this: P1 (Critical) → `CRITICAL`, P2 (High) → `HIGH`, P3 → `MEDIUM`, P4 → `LOW`.

---

## Placeholder endpoints

`GET /api/dashboard`, `GET /api/dashboard/metrics`, `GET /api/chat/channels`, `GET /api/chat/channels/:channelId/messages` and `GET /api/user/me` all require sign-in. Apart from `user/me`, they return **fixed sample data**, not real data. Don't build on them.

---

## Live updates (Socket.IO)

Connect to the same origin. The path is the default, `/socket.io`. Pass the token in the handshake:

```js
import { io } from "socket.io-client";
const socket = io("https://FORD-DC01:5543", { auth: (cb) => cb({ token: getToken() }) });
```

Connections without a valid token are refused with `Authentication required`. When a password change, reset, role change or deactivation revokes a token, the server disconnects that user's sockets.

**Server to client:**

| Event | Payload | When |
|---|---|---|
| `incident:created` | Incident | Created in the dashboard or ingested |
| `incident:updated` | Incident | Status changed |
| `incident:locked` | `{ incidentId, lockedBy }` | Lock taken |
| `presence:update` | Online users | Someone joins or leaves |
| `message:new` | Chat message | Chat (sample feature) |
| `user:typing`, `user:typing:stop` | `{ userId, userName?, channel? }` | Chat (sample feature) |

**Client to server:** `user:join`, `message:send` (with an acknowledgement callback), `user:typing` and `user:typing:stop`. These are all part of the sample chat feature.

---

## Errors

Errors are JSON with an `error` message. Some add more fields:

| Shape | Used for |
|---|---|
| `{ "error": "…" }` | Most errors (401, 403, 404, 409, 429, 500, 503) |
| `{ "error": "Validation failed", "details": ["title: is required", "severity: must be one of CRITICAL, HIGH, MEDIUM, LOW"] }` | 400 from input validation |
| `{ "error": "Password change required", "code": "PASSWORD_CHANGE_REQUIRED" }` | 403 before the first password change |
| `{ "error": "Request body is not valid JSON", "status": 400 }` | Malformed JSON |
| `{ "error": "Request body is too large", "status": 413 }` | Bodies over 100 kB |
| `{ "error": "Not Found", "path": "…", "method": "…", "message": "…" }` | Unknown routes |

| Status | Meaning |
|---|---|
| 401 | Missing, expired or revoked token, or a wrong API key |
| 403 | The role isn't allowed, or a password change is required |

## Rate limits

The limits apply per client IP, over a 15-minute window. The defaults can be changed with environment variables.

| Limit | Default | Variable | Applies to |
|---|---|---|---|
| API | 600 | `RATE_LIMIT_API` | Every `/api` route except ingest |
| Failed sign-ins | 10 per IP and email | `RATE_LIMIT_LOGIN` | `POST /api/auth/login`; successful sign-ins don't count |
| Ingest | 2,000 | `RATE_LIMIT_INGEST` | `/api/ingest/*` |

Responses carry the standard `RateLimit` and `RateLimit-Policy` headers (IETF draft 7). Over the limit, the server returns **429** with an `error` message.

## Other behaviour

- **Request size:** JSON and form bodies are limited to 100 kB.
- **CORS:** the allowed origins come from `CORS_ORIGINS`, by default `http://localhost:3000,http://localhost:3001`. In production the dashboard is served from the same origin, so CORS doesn't apply to it.
- **Security headers:** helmet. HSTS and `upgrade-insecure-requests` apply over HTTPS. The Content-Security-Policy allows only same-origin scripts.
- **Logging:**
  - Every request is logged as JSON with the user, route, status and duration.
  - Security events go to the audit log: sign-ins, password changes, user changes and resets.
  - Logs are in `backend/server/logs/`.

## Examples

**PowerShell 7, production:**

```powershell
$base = 'https://FORD-DC01:5543'
$cred = Get-Credential -Message 'DeskSOS Enterprise'
$login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email = $cred.UserName; password = $cred.GetNetworkCredential().Password } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod "$base/api/incidents" -Headers $h | Select-Object -First 5 id, severity, status, title
```

**curl, development:**

```bash
TOKEN=$(curl -s localhost:5100/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@desksos.local","password":"…"}' | jq -r .token)
curl -s localhost:5100/api/incidents -H "Authorization: Bearer $TOKEN"
```

**Ingest test (development; the key is in `backend/server/.env`):**

```bash
curl -s localhost:5100/api/ingest/incidents -H "X-API-Key: $INGEST_API_KEY" -H 'Content-Type: application/json' \
  -d '{"source":"manual-test","externalId":"test-1","title":"Test","description":"Ingest test","severity":"LOW"}'
```

---

Last checked against the code: 2026-10-06.
