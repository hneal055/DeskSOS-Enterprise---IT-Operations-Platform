import dotenv from "dotenv";
import path from "path";

// Load .env before reading process.env below; config is imported before the
// index.ts body runs, so loading it there was too late.
// Resolve backend/server/.env from this file (src/config or dist/config) rather
// than the process cwd: PM2 launched from the repo root otherwise picks up the
// unrelated root .env (PORT=8000) and crashes with EADDRINUSE.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

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
  console.error(`  Set it in backend/server/.env. Generate one with:`);
  console.error(`  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`);
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
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, "..", "..", "data", "enterprise.db"),
  // Shared secret for machine-to-machine ingest (DeskSOS Desktop backend).
  // Ingest is disabled while unset.
  ingestApiKey: process.env.INGEST_API_KEY || "",
};

export default config;
