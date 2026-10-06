import { SENTRY_ENABLED } from "./instrument"; // first, so Sentry can instrument express
import * as Sentry from "@sentry/node";
import express, { Express } from "express";
import cors from "cors";
import fs from "fs";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import { Server as SocketIOServer } from "socket.io";
import config from "./config"; // loads .env
import dashboardRoutes from "./routes/dashboard";
import chatRoutes from "./routes/chat";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import incidentRoutes from "./routes/incidents";
import ingestRoutes from "./routes/ingest";
import adminUserRoutes from "./routes/adminUsers";
import { initializeSocket } from "./services/socket";
import { pingDatabase } from "./db";
import { ensureInitialAdmin } from "./users";
import { requireAuth, requireRole } from "./middleware/auth";
import { securityHeaders, apiLimiter, loginLimiter, ingestLimiter } from "./middleware/security";
import { serveDashboard } from "./static";
import { logger } from "./logger";
import { requestLogger } from "./middleware/requestLog";

// Initialize Express
const app: Express = express();

// HTTP or HTTPS server (same Express app and Socket.IO either way)
function readTls(): { cert: Buffer; key: Buffer } {
  try {
    return { cert: fs.readFileSync(config.tlsCertPath), key: fs.readFileSync(config.tlsKeyPath) };
  } catch (err) {
    console.error(`[DeskSOS] FATAL: can't read the TLS certificate or key: ${(err as Error).message}`);
    console.error("  Generate them with: pwsh backend/server/scripts/gen-cert.ps1");
    process.exit(1);
  }
}
const httpServer = config.tlsEnabled ? createHttpsServer(readTls(), app) : createServer(app);

// Socket.IO, restricted to the configured browser origins
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  },
});
app.set('io', io);

// Request log first, so every response is logged (including body-parser
// errors such as 413), then security headers on every response
app.use(requestLogger);
app.use(securityHeaders);

app.use(
  cors({
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true,
  })
);

// Body parsers with a size cap. The largest legitimate payload is an ingested
// ticket (description up to 20,000 characters), well under 100 KB.
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// API Routes
// Sign-in is enforced where each router is mounted, so no route under these
// prefixes can be left open by accident. Exceptions: /api/auth (login itself;
// its own routes opt in) and /api/ingest (machine-to-machine, X-API-Key).
// Rate limits: the stricter sign-in limit runs before the general one.
// Ingest has its own allowance so a bridge backlog isn't throttled by UI traffic.
app.use("/api/auth/login", loginLimiter);
app.use("/api/ingest", ingestLimiter);
app.use("/api", apiLimiter); // skips /api/ingest itself

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", requireAuth(), dashboardRoutes);
app.use("/api/chat", requireAuth(), chatRoutes);
app.use("/api/user", requireAuth(), userRoutes);
app.use("/api/incidents", requireAuth(), incidentRoutes);
app.use("/api/admin/users", requireAuth(), requireRole("admin"), adminUserRoutes);
app.use("/api/ingest", ingestRoutes);

// Health check: reports the real state of the incidents database
app.get("/health", (req, res) => {
  try {
    pingDatabase();
    res.json({ status: "ok", timestamp: new Date().toISOString(), services: { database: "connected" } });
  } catch (err) {
    logger.error("Health check: database unavailable", { error: (err as Error).message });
    res.status(503).json({ status: "error", timestamp: new Date().toISOString(), services: { database: "unavailable" } });
  }
});

// API information (no data). At "/" too when the dashboard isn't served here.
const apiInfo = (_req: express.Request, res: express.Response) => {
  res.json({
    message: "DeskSOS Enterprise API Server",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      incidents: "GET, POST, PATCH /api/incidents",
      ingest: "POST /api/ingest/incidents (X-API-Key)",
      dashboard: "GET /api/dashboard",
    },
  });
};
app.get("/api", apiInfo);

if (config.serveClient) {
  serveDashboard(app, config.clientBuildPath);
} else {
  app.get("/", apiInfo);
}

// Initialize Socket.IO event handlers
initializeSocket(io);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    method: req.method,
    message: "Endpoint does not exist. See GET /api for available endpoints.",
  });
});

// Report unhandled route errors (5xx) to Sentry when configured, before responding
if (SENTRY_ENABLED) Sentry.setupExpressErrorHandler(app);

// Error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const status = Number(err.status) || 500;
    // Body parser errors are the client's fault; describe them plainly
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Request body is not valid JSON", status: 400 });
    }
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body is too large", status: 413 });
    }
    logger.error("Unhandled request error", { method: req.method, path: req.path, status, error: err });
    // Never send internal error details to the client
    res.status(status).json({
      error: status >= 500 ? "Internal Server Error" : err.message || "Request failed",
      status,
    });
  }
);

// Start server (skipped when imported by tests)
if (require.main === module) {
  const initialAdmin = ensureInitialAdmin();
  if (initialAdmin) {
    console.log("=".repeat(64));
    console.log("  DESKSOS ENTERPRISE FIRST-RUN ADMIN ACCOUNT. SAVE THIS NOW.");
    console.log(`  Email:    ${initialAdmin.email}`);
    console.log(`  Password: ${initialAdmin.password}`);
    console.log("  It is shown only once and must be changed at first sign-in.");
    console.log("=".repeat(64));
  }

  const PORT = config.port;
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[DeskSOS] FATAL: port ${PORT} is already in use.`);
      process.exit(1);
    }
    throw err;
  });
  httpServer.listen(PORT, () => {
    logger.info(`DeskSOS Backend is Live and Synced on port ${PORT} (${config.tlsEnabled ? "HTTPS" : "HTTP"}, ${config.nodeEnv})`, {
      type: "startup", port: PORT, https: config.tlsEnabled, env: config.nodeEnv,
    });
  });
}

export { app, io, httpServer };
