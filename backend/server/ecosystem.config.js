/**
 * PM2 configuration for DeskSOS Enterprise production.
 *
 * Start it with the repo-root script, which also builds, checks the
 * certificate and secrets, and verifies health:
 *   .\start-production.ps1
 *
 * Useful commands (from an Administrator window):
 *   pm2 status
 *   pm2 logs desksos-enterprise
 *   pm2 stop desksos-enterprise
 *
 * Production runs alongside development on the same PC, so it has its own
 * name, port and database. Development stays on 5100 + data/enterprise.db
 * (PM2 name desksos-enterprise-backend). Secrets come from
 * backend/server/.env.production (ignored by git), never from this file.
 *
 * DESKSOS_PROD_* environment variables override the defaults below; they
 * exist so the start script can be tested without touching production.
 */
const env = process.env;

module.exports = {
  apps: [
    {
      name: env.DESKSOS_PROD_NAME || "desksos-enterprise",
      script: "dist/index.js",
      cwd: __dirname,

      instances: 1,          // SQLite: one writer process
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",     // must stay up 10 s to count as started
      restart_delay: 3000,
      max_memory_restart: "512M",

      out_file: env.DESKSOS_PROD_OUT_LOG || "logs/pm2-out.log",
      error_file: env.DESKSOS_PROD_ERR_LOG || "logs/pm2-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env_production: {
        NODE_ENV: "production",
        PORT: env.DESKSOS_PROD_PORT || "5543",
        DATABASE_PATH: env.DESKSOS_PROD_DB || "./data/enterprise-prod.db",
        TLS_CERT_PATH: "./certs/server.crt",
        TLS_KEY_PATH: "./certs/server.key",
        SERVE_CLIENT: "true",
        // The shared .env sets debug for development; production logs info
        // and above (no per-request lines for health checks and static files)
        LOG_LEVEL: env.DESKSOS_PROD_LOG_LEVEL || "info",
        // The dashboard is served from the same origin; listed for clarity
        CORS_ORIGINS: env.DESKSOS_PROD_ORIGINS || "https://FORD-DC01:5543,https://localhost:5543",
      },
    },
  ],
};
