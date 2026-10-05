import crypto from "crypto";
import { db } from "./db";

export type Role = "admin" | "operator" | "viewer";
export const ROLES: Role[] = ["admin", "operator", "viewer"];

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  tokenVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  active: number;
  must_change_password: number;
  token_version: number;
  created_at: string;
  last_login_at: string | null;
}

export const MIN_PASSWORD_LENGTH = 12;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name                 TEXT NOT NULL,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
    active               INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    token_version        INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    last_login_at        TEXT
  );
`);

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    active: r.active === 1,
    mustChangePassword: r.must_change_password === 1,
    tokenVersion: r.token_version,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}

// ── Password hashing (scrypt, built into Node) ──────────────────────────────
// Stored as: scrypt$N$r$p$<salt base64>$<hash base64>
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAXMEM,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the email doesn't exist, so a failed login takes about as long
// either way and response timing doesn't reveal which emails have accounts.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export function generatePassword(): string {
  return crypto.randomBytes(18).toString("base64url"); // 24 characters
}

// ── Queries ─────────────────────────────────────────────────────────────────
export function getUser(id: number): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row && toUser(row);
}

export function countUsers(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
  mustChangePassword?: boolean;
}): User {
  const info = db
    .prepare(
      `INSERT INTO users (email, name, password_hash, role, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.email.trim(),
      input.name.trim(),
      hashPassword(input.password),
      input.role,
      input.mustChangePassword ? 1 : 0,
      new Date().toISOString()
    );
  return getUser(Number(info.lastInsertRowid))!;
}

// Returns the user only if the email exists, the account is active and the
// password matches. Callers must not reveal which of those failed.
export function authenticate(email: string, password: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim()) as UserRow | undefined;
  const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok || row.active !== 1) return null;
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return getUser(row.id)!;
}

export function verifyPasswordFor(id: number, password: string): boolean {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string } | undefined;
  return !!row && verifyPassword(password, row.password_hash);
}

// Changing the password bumps token_version, which invalidates every token
// issued before the change.
export function setPassword(id: number, password: string, opts: { mustChange?: boolean } = {}): User {
  db.prepare(
    `UPDATE users
     SET password_hash = ?, must_change_password = ?, token_version = token_version + 1
     WHERE id = ?`
  ).run(hashPassword(password), opts.mustChange ? 1 : 0, id);
  return getUser(id)!;
}

export function checkPasswordStrength(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 256) return "Password must be at most 256 characters";
  return null;
}

// First run: with no accounts at all, create an admin with a random password
// that must be changed at first sign-in. Returns the password so the caller
// can show it once; returns null if users already exist.
export function ensureInitialAdmin(email = "admin@desksos.local"): { email: string; password: string } | null {
  if (countUsers() > 0) return null;
  const password = generatePassword();
  createUser({ email, name: "Administrator", password, role: "admin", mustChangePassword: true });
  return { email, password };
}
