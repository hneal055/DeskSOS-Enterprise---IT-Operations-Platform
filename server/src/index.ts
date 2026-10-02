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
import { initializeSocket } from "./services/socket";

dotenv.config();

const app: Express = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
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

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Root route - API documentation
app.get("/", (req, res) => {
  res.json({
    message: "DeskSOS Enterprise API Server",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      dashboard: {
        data: "GET /api/dashboard",
        metrics: "GET /api/dashboard/metrics"
      },
      chat: {
        channels: "GET /api/chat/channels",
        messages: "GET /api/chat/channels/:channelId/messages"
      },
      auth: {
        login: "POST /api/auth/login",
        register: "POST /api/auth/register",
        logout: "POST /api/auth/logout"
      },
      user: {
        profile: "GET /api/user/me"
      }
    },
    websocket: {
      url: "ws://localhost:5000/socket.io",
      events: {
        user_join: "user:join",
        message_send: "message:send",
        message_new: "message:new",
        user_typing: "user:typing",
        presence_update: "presence:update"
      }
    }
  });
});

// Initialize Socket.io
initializeSocket(io);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    method: req.method,
    message: "Endpoint does not exist. See GET / for available endpoints."
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    status: err.status || 500,
  });
});

const PORT = config.port;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`API Documentation available at http://localhost:${PORT}/`);
});

export { app, io };
