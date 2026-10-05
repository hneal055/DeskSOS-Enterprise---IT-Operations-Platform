#!/usr/bin/env node
/**
 * DeskSOS Enterprise — account recovery from the server
 *
 * Resets a user's password to a new temporary one (shown once, must be changed
 * at next sign-in), reactivates the account if it was deactivated, and ends
 * all of its sessions. For when nobody can sign in as an admin anymore.
 *
 * Usage (from backend/server, after `npm run build`):
 *   npm run user:reset-password -- admin@desksos.local
 *   npm run user:reset-password -- --list        # show accounts
 *
 * Uses the same .env and database as the server (DATABASE_PATH respected).
 */

"use strict";

const path = require("path");
const dist = path.join(__dirname, "..", "dist");

let users;
try {
  users = require(path.join(dist, "users"));
} catch (err) {
  console.error("Could not load the built server. Run `npm run build` in backend/server first.");
  console.error(err.message);
  process.exit(1);
}

const arg = process.argv[2];

if (!arg || arg === "--help") {
  console.log("Usage: npm run user:reset-password -- <email>   |   --list");
  process.exit(arg ? 0 : 1);
}

if (arg === "--list") {
  const all = users.listUsers();
  if (!all.length) console.log("No accounts yet. Start the server once to create the first admin.");
  for (const u of all) {
    console.log(`${u.active ? "active  " : "inactive"}  ${u.role.padEnd(8)}  ${u.email}  (${u.name})`);
  }
  process.exit(0);
}

const user = users.findUserByEmail(arg);
if (!user) {
  console.error(`No account with email ${arg}. Use --list to see accounts.`);
  process.exit(1);
}

if (!user.active) users.updateUser(user.id, { active: true });
const password = users.resetPassword(user.id);

console.log("=".repeat(64));
console.log(`  Password reset for ${user.email} (${user.role})${user.active ? "" : ", account reactivated"}`);
console.log(`  Temporary password: ${password}`);
console.log("  It is shown only once and must be changed at next sign-in.");
console.log("  All existing sessions for this account have been ended.");
console.log("=".repeat(64));
