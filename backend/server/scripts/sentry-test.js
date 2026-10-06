#!/usr/bin/env node
/**
 * Sends one test error to Sentry, to check that SENTRY_DSN works (plan task 3.5:
 * "a test error appears in Sentry"). Uses the same settings as the server.
 *
 *   cd backend\server
 *   npm run build
 *   npm run sentry:test                       # uses SENTRY_DSN from .env
 *   $env:NODE_ENV='production'; npm run sentry:test   # production settings (.env.production)
 */
"use strict";

const path = require("path");
let instrument, Sentry;
try {
  instrument = require(path.join(__dirname, "..", "dist", "instrument"));
  Sentry = require("@sentry/node");
} catch (err) {
  console.error("Could not load the built server. Run `npm run build` in backend/server first.");
  console.error(err.message);
  process.exit(1);
}

if (!instrument.SENTRY_ENABLED) {
  console.error("SENTRY_DSN isn't set (or NODE_ENV is test), so nothing was sent.");
  process.exit(1);
}

const id = Sentry.captureException(new Error(`DeskSOS Enterprise Sentry test (${new Date().toISOString()})`));
Sentry.flush(10000).then((ok) => {
  if (ok) {
    console.log(`Sent test error ${id}. Look for "DeskSOS Enterprise Sentry test" in the Sentry project.`);
    process.exit(0);
  }
  console.error("Timed out sending to Sentry: check the DSN and that this PC can reach it.");
  process.exit(1);
});
