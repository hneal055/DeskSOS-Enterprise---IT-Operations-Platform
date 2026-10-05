import { Request } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import config from "../config";

// Standard security headers (no X-Powered-By, nosniff, frame protection,
// HSTS, referrer policy, and a strict CSP). helmet's default CSP already fits
// the built dashboard: scripts and styles come from this origin, Google Fonts
// from https:, and the live socket from 'self'. The Vite build has no inline
// scripts, so script-src stays 'self'.
//
// upgrade-insecure-requests makes browsers fetch even this server's own files
// over HTTPS, which breaks a plain-HTTP deployment, so it's only sent once
// HTTPS is enabled (plan task 2.3).
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      "upgrade-insecure-requests": config.tlsEnabled ? [] : null,
    },
  },
});

const common = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: "draft-7" as const, // RateLimit-* headers tell clients when to retry
  legacyHeaders: false,
};

// General limit for API traffic, per client IP. Ingest is skipped: it has its
// own allowance, so a bridge backlog isn't blocked by dashboard traffic.
export const apiLimiter = rateLimit({
  ...common,
  limit: config.rateLimit.api,
  skip: (req: Request) => req.originalUrl.startsWith("/api/ingest"),
  message: { error: "Too many requests, please try again later." },
});

// Brute-force protection for sign-in: counts failed attempts per IP and
// email, so one person mistyping doesn't lock out everyone on their network
// and an attacker can't guess one account's password indefinitely.
export const loginLimiter = rateLimit({
  ...common,
  limit: config.rateLimit.login,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${req.ip}|${email}`;
  },
  message: { error: "Too many failed sign-in attempts. Please wait 15 minutes and try again." },
});

// Machine-to-machine intake from the Desktop bridge, which retries on 429
export const ingestLimiter = rateLimit({
  ...common,
  limit: config.rateLimit.ingest,
  message: { error: "Too many ingest requests, please retry later." },
});
