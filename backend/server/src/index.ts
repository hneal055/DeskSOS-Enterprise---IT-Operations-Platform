import express, { Express } from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";
import config from "./config";
import dashboardRoutes from "./routes/dashboard";
import chatRoutes from "./routes/chat";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import incidentRoutes from "./routes/incidents";
import { initializeSocket } from "./services/socket";

dotenv.config();

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
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/user", userRoutes);
app.use("/api/incidents", incidentRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: { database: "connected", cache: "connected" }
  });
});

// Root API documentation
app.get("/", (req, res) => {
  res.json({
    message: "DeskSOS Enterprise API Server",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      incidents: "GET, POST, PATCH /api/incidents",
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

// Start server
const PORT = config.port;
httpServer.listen(PORT, () => {
  console.log(`=====================================`);
  console.log(`DeskSOS Backend is Live and Synced on port ${PORT}!`);
  console.log(`=====================================`);
});

export { app, io };
