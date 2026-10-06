import dotenv from "dotenv";
import path from "path";

// backend/server, from src/config or dist/config
const SERVER_DIR = path.resolve(__dirname, "..", "..");

// Load .env before reading process.env below; config is imported before the
// index.ts body runs, so loading it there was too late.
// Resolve backend/server/.env from this file rather than the process cwd: PM2
// launched from the repo root otherwise picks up the unrelated root .env
// (PORT=8000) and crashes with EADDRINUSE.
//
// In production, backend/server/.env.production is loaded first and OVERRIDES
// inherited environment variables: production's secrets must win even over a
// stale value passed down by a shell or the PM2 daemon (a leftover user-level
// JWT_SECRET did exactly that). Keep only secrets in that file; settings such
// as PORT come from ecosystem.config.js. The shared .env is then loaded
// without overriding. Dev and production must not share JWT_SECRET: user ids
// exist in both databases, so a dev token could otherwise work on production.
export function envFilesFor(nodeEnv: string | undefined, dir = SERVER_DIR): { path: string; override: boolean }[] {
  const shared = { path: path.join(dir, ".env"), override: false };
  return nodeEnv === "production" ? [{ path: path.join(dir, ".env.production"), override: true }, shared] : [shared];
}
for (const file of envFilesFor(process.env.NODE_ENV)) dotenv.config(file);

// Paths in settings are relative to backend/server
const fromServerDir = (p: string) => (path.isAbsolute(p) ? p : path.join(SERVER_DIR, p));

// Placeholder values that have appeared in this repo's examples and docs.
// Anyone can read them, so tokens signed with them could be forged.
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "your-secret-key-change-this-in-production",
  "your-super-secret-jwt-key-change-in-production",
  "your-secret-key",
]);

// Refuse to start without a strong token-signing secret: there is no fallback.
export function checkJwtSecret(secret: string | undefined): string | null {
  if (!secret) return "JWT_SECRET is not set";
  if (KNOWN_PLACEHOLDER_SECRETS.has(secret)) return "JWT_SECRET is a published placeholder value";
  if (secret.length < 32) return "JWT_SECRET must be at least 32 characters";
  return null;
}

const jwtSecretError = checkJwtSecret(process.env.JWT_SECRET);
if (jwtSecretError) {
  console.error(`[DeskSOS] FATAL: ${jwtSecretError}.`);
  console.error(`  Set it in backend/server/.env${process.env.NODE_ENV === "production" ? ".production" : ""}. Generate one with:`);
  console.error(`  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`);
  process.exit(1);
}

// HTTPS: both TLS_CERT_PATH and TLS_KEY_PATH, or neither. Production requires
// HTTPS unless ALLOW_HTTP_IN_PRODUCTION=true (e.g. behind a TLS proxy).
export function checkTls(env: NodeJS.ProcessEnv): string | null {
  const cert = env.TLS_CERT_PATH?.trim();
  const key = env.TLS_KEY_PATH?.trim();
  if (Boolean(cert) !== Boolean(key)) return "set both TLS_CERT_PATH and TLS_KEY_PATH, or neither";
  if (!cert && env.NODE_ENV === "production" && env.ALLOW_HTTP_IN_PRODUCTION !== "true") {
    return "production requires HTTPS: set TLS_CERT_PATH and TLS_KEY_PATH (see scripts/gen-cert.ps1)";
  }
  return null;
}

const tlsError = checkTls(process.env);
if (tlsError) {
  console.error(`[DeskSOS] FATAL: ${tlsError}.`);
  process.exit(1);
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  // 5100: port 5000 belongs to the DeskSOS Desktop dev backend on the same PC
  port: parseInt(process.env.PORT || "5100", 10),
  jwtSecret: process.env.JWT_SECRET as string,
  logLevel: process.env.LOG_LEVEL || "info",
  isDevelopment: process.env.NODE_ENV !== "production",
  isProduction: process.env.NODE_ENV === "production",
  // SQLite file for incidents; ":memory:" in tests
  databasePath:
    process.env.DATABASE_PATH === ":memory:"
      ? ":memory:"
      : fromServerDir(process.env.DATABASE_PATH || path.join("data", "enterprise.db")),
  // Shared secret for machine-to-machine ingest (DeskSOS Desktop backend).
  // Ingest is disabled while unset.
  ingestApiKey: process.env.INGEST_API_KEY || "",
  // Browser origins allowed to call the API and open the socket
  // (comma-separated). Defaults to the local dashboard dev servers.
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  // Requests per IP per 15 minutes. The dashboard polls every 15 s (60 per
  // window per open tab), so the general limit leaves room for several tabs.
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    api: positiveInt(process.env.RATE_LIMIT_API, 600),
    // Failed sign-ins per IP + email; successful ones don't count
    login: positiveInt(process.env.RATE_LIMIT_LOGIN, 10),
    // The Desktop bridge can send a backlog after an outage (20 per 15 s)
    ingest: positiveInt(process.env.RATE_LIMIT_INGEST, 2000),
  },
  // Serve the built dashboard (client/build) from this server, so production
  // needs one port and no dev server. On by default in production; in
  // development the Vite dev server on :3000 is normally used instead.
  serveClient: bool(process.env.SERVE_CLIENT, process.env.NODE_ENV === "production"),
  // From src/config or dist/config, four levels up is the repo root
  clientBuildPath: process.env.CLIENT_BUILD_PATH || path.join(__dirname, "..", "..", "..", "..", "client", "build"),
  // HTTPS certificate and key (PEM), relative to backend/server
  tlsCertPath: process.env.TLS_CERT_PATH?.trim() ? fromServerDir(process.env.TLS_CERT_PATH.trim()) : "",
  tlsKeyPath: process.env.TLS_KEY_PATH?.trim() ? fromServerDir(process.env.TLS_KEY_PATH.trim()) : "",
  tlsEnabled: Boolean(process.env.TLS_CERT_PATH?.trim() && process.env.TLS_KEY_PATH?.trim()),
  // Sentry error tracking (plan task 3.5); off unless set
  sentryDsn: process.env.SENTRY_DSN?.trim() || "",
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export default config;
