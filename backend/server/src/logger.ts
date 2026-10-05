import winston from "winston";

// One logger for the whole server, writing to stdout/stderr. PM2 captures the
// output into its log files and the pm2-logrotate module rotates them (daily,
// 14 days kept, compressed), so the server doesn't manage log files itself.
//
// Production writes one JSON object per line (easy to search and parse);
// development writes short readable lines. Tests are silent unless a test
// adds its own transport.
//
// Never log passwords, tokens or API keys.

const env = process.env.NODE_ENV;
const production = env === "production";

const readable = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const extra = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  return `${timestamp} ${level} ${message}${extra}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (production ? "info" : "debug"),
  silent: env === "test",
  format: production
    ? winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json())
    : winston.format.combine(
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.errors({ stack: true }),
        readable
      ),
  transports: [new winston.transports.Console({ stderrLevels: ["error"] })],
});

// Security-relevant events in one consistent shape: { type: "audit", event, ... }
export function audit(event: string, fields: Record<string, unknown>, level: "info" | "warn" = "info"): void {
  logger.log(level, event, { type: "audit", event, ...fields });
}
