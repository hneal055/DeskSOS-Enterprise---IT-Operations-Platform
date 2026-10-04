#!/usr/bin/env node
/**
 * DeskSOS Enterprise — SQLite online backup
 *
 * Uses better-sqlite3's .backup(), which copies a consistent snapshot of a
 * live database, including changes still in the -wal file. (Copying only the
 * .db file misses those, so older file-copy backups could be nearly empty.)
 * Each backup is checked with PRAGMA integrity_check before older ones are
 * pruned. Secrets (.env) are deliberately not backed up here.
 *
 * Usage:
 *   node backend/server/scripts/backup-db.js
 *
 * Environment variables:
 *   DATABASE_PATH  source database   (default: backend/server/data/enterprise.db)
 *   BACKUP_DIR     backup directory  (default: <repo>/backups)
 *   BACKUP_KEEP    backups to keep   (default: 14; oldest are pruned)
 */

"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const serverDir = path.join(__dirname, "..");
const repoRoot = path.join(serverDir, "..", "..");

async function main() {
  const dbPath = process.env.DATABASE_PATH || path.join(serverDir, "data", "enterprise.db");
  const backupDir = process.env.BACKUP_DIR || path.join(repoRoot, "backups");
  const keepCount = Number(process.env.BACKUP_KEEP || "14");

  if (!fs.existsSync(dbPath)) {
    console.error(`[backup] Source database not found: ${dbPath}`);
    process.exit(1);
  }
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const destPath = path.join(backupDir, `enterprise-${stamp}.db`);
  console.log(`[backup] ${dbPath} -> ${destPath}`);

  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destPath);
  } finally {
    source.close();
  }

  // The copy inherits WAL mode from the live database; switch it to rollback
  // journal mode so the backup is one self-contained file with no -wal/-shm.
  // Then verify it before trusting it (and before pruning older backups).
  const copy = new Database(destPath, { fileMustExist: true });
  let incidents;
  try {
    copy.pragma("journal_mode = DELETE");
    const integrity = copy.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`integrity_check failed: ${integrity}`);
    incidents = copy.prepare("SELECT COUNT(*) AS n FROM incidents").get().n;
  } finally {
    copy.close();
  }
  console.log(`[backup] Verified: integrity ok, ${incidents} incident(s)`);

  const existing = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("enterprise-") && f.endsWith(".db"))
    .sort(); // ISO timestamps sort oldest first
  for (const f of existing.slice(0, Math.max(0, existing.length - keepCount))) {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(path.join(backupDir, f + suffix), { force: true });
    }
    console.log(`[backup] Pruned old backup: ${f}`);
  }
  console.log(`[backup] Kept ${Math.min(existing.length, keepCount)} backup(s) in ${backupDir}`);
}

main().catch((err) => {
  console.error("[backup] Failed:", err.message);
  process.exit(1);
});
