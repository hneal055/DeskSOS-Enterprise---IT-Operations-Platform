import express, { Express } from "express";
import cors from "cors";
import { createServer } from "http";
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

// Initialize Express
const app: Express = express();

// Create HTTP server
const httpServer = createServer(app);

// Socket.IO, restricted to the configured browser origins
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  },
});
app.set('io', io);

// Security headers first, so they're on every response (including errors)
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

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

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
    console.error("[health] Database check failed:", (err as Error).message);
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
    console.error("Error:", err);
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
  httpServer.listen(PORT, () => {
    console.log(`=====================================`);
    console.log(`DeskSOS Backend is Live and Synced on port ${PORT}!`);
    console.log(`=====================================`);
  });
}

export { app, io, httpServer };
