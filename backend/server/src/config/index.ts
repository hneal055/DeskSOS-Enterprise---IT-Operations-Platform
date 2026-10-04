import dotenv from "dotenv";
import path from "path";

// Load .env before reading process.env below; config is imported before the
// index.ts body runs, so loading it there was too late.
// Resolve backend/server/.env from this file (src/config or dist/config) rather
// than the process cwd: PM2 launched from the repo root otherwise picks up the
// unrelated root .env (PORT=8000) and crashes with EADDRINUSE.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  // 5100: port 5000 belongs to the DeskSOS Desktop dev backend on the same PC
  port: parseInt(process.env.PORT || "5100", 10),
  jwtSecret: process.env.JWT_SECRET || "your-secret-key-change-this-in-production",
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
