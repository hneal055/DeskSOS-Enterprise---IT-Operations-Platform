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
import { initializeSocket } from "./services/socket";
import { pingDatabase } from "./db";
import { ensureInitialAdmin } from "./users";
import { requireAuth } from "./middleware/auth";

// Initialize Express
const app: Express = express();

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO with corrected CORS
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true
  },
});
app.set('io', io);
// Global CORS middleware for Express
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true,
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// API Routes
// Sign-in is enforced where each router is mounted, so no route under these
// prefixes can be left open by accident. Exceptions: /api/auth (login itself;
// its own routes opt in) and /api/ingest (machine-to-machine, X-API-Key).
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", requireAuth(), dashboardRoutes);
app.use("/api/chat", requireAuth(), chatRoutes);
app.use("/api/user", requireAuth(), userRoutes);
app.use("/api/incidents", requireAuth(), incidentRoutes);
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

// Root API documentation
app.get("/", (req, res) => {
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
});

// Initialize Socket.IO event handlers
initializeSocket(io);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    method: req.method,
    message: "Endpoint does not exist. See GET / for available endpoints.",
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
    console.error("Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      status: err.status || 500,
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
