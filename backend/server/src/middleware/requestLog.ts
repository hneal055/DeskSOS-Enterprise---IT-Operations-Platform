import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

// One log entry per request once the response is sent:
// { type: "request", method, path, status, durationMs, user, ip }.
// The query string is left out (it could carry data that shouldn't be kept).
// Health checks and static files are routine, so they're logged at debug.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const path = req.originalUrl.split("?")[0];
    const routine = path === "/health" || !path.startsWith("/api");
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 && !routine ? "warn" : routine ? "debug" : "info";
    logger.log(level, `${req.method} ${path} ${res.statusCode}`, {
      type: "request",
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10,
      user: req.user?.email ?? null,
      ip: req.ip,
    });
  });
  next();
}
