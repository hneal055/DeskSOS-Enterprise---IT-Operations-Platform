import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import config from "./config";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export interface Incident {
  id: number;
  title: string;
  description: string;
  category: string;
  severity: Severity;
  status: string;
  location: { latitude: number; longitude: number };
  assignedTo: string;
  source: string;
  externalId: string | null;
  requester: string | null;
  created_at: string;
  updated_at: string;
}

interface IncidentRow {
  id: number;
  title: string;
  description: string;
  category: string;
  severity: Severity;
  status: string;
  latitude: number;
  longitude: number;
  assigned_to: string;
  source: string;
  external_id: string | null;
  requester: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewIncident {
  title: string;
  description: string;
  category?: string;
  severity?: Severity;
  status?: string;
  latitude?: number;
  longitude?: number;
  assignedTo?: string;
  source?: string;
  externalId?: string | null;
  requester?: string | null;
}

const DEFAULT_LAT = 34.0522;
const DEFAULT_LON = -118.2437;

if (config.databasePath !== ":memory:") {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
}

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS incidents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Infrastructure',
    severity    TEXT NOT NULL DEFAULT 'MEDIUM',
    status      TEXT NOT NULL DEFAULT 'Open',
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    assigned_to TEXT NOT NULL DEFAULT 'Unassigned',
    source      TEXT NOT NULL DEFAULT 'enterprise-ui',
    external_id TEXT,
    requester   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  -- One incident per external ticket, so ingest retries never duplicate
  CREATE UNIQUE INDEX IF NOT EXISTS incidents_source_external
    ON incidents (source, external_id) WHERE external_id IS NOT NULL;
`);

function toIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    severity: r.severity,
    status: r.status,
    location: { latitude: r.latitude, longitude: r.longitude },
    assignedTo: r.assigned_to,
    source: r.source,
    externalId: r.external_id,
    requester: r.requester,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function listIncidents(limit = 500): Incident[] {
  const rows = db
    .prepare("SELECT * FROM incidents ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as IncidentRow[];
  return rows.map(toIncident);
}

export function getIncident(id: number): Incident | undefined {
  const row = db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as IncidentRow | undefined;
  return row && toIncident(row);
}

export function findByExternalId(source: string, externalId: string): Incident | undefined {
  const row = db
    .prepare("SELECT * FROM incidents WHERE source = ? AND external_id = ?")
    .get(source, externalId) as IncidentRow | undefined;
  return row && toIncident(row);
}

export function createIncident(input: NewIncident): Incident {
  const now = new Date().toISOString();
  const lat = Number.isFinite(input.latitude) ? input.latitude! : DEFAULT_LAT;
  const lon = Number.isFinite(input.longitude) ? input.longitude! : DEFAULT_LON;
  const info = db
    .prepare(
      `INSERT INTO incidents
         (title, description, category, severity, status, latitude, longitude,
          assigned_to, source, external_id, requester, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.title,
      input.description,
      input.category || "Infrastructure",
      input.severity || "MEDIUM",
      input.status || "Open",
      lat,
      lon,
      input.assignedTo || "Unassigned",
      input.source || "enterprise-ui",
      input.externalId ?? null,
      input.requester ?? null,
      now,
      now
    );
  return getIncident(Number(info.lastInsertRowid))!;
}

export function updateIncidentStatus(id: number, status: string): Incident | undefined {
  const info = db
    .prepare("UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
  return info.changes ? getIncident(id) : undefined;
}

export function pingDatabase(): void {
  db.prepare("SELECT COUNT(*) AS n FROM incidents").get();
}

// Sample data for local development only
if (!config.isProduction && config.databasePath !== ":memory:") {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM incidents").get() as { n: number };
  if (n === 0) {
    createIncident({
      title: "Docker Daemon crash on production node",
      description: "Primary container engine terminated unexpectedly due to OOM killer invocation.",
      category: "Infrastructure",
      severity: "CRITICAL",
      assignedTo: "Node-Ops-Lead",
    });
    createIncident({
      title: "PostgreSQL Connection Pool Saturation",
      description: "Active database connections exceeded max pool limit under heavy analytics query load.",
      category: "Database",
      severity: "HIGH",
      status: "In Progress",
      latitude: 34.055,
      longitude: -118.245,
      assignedTo: "DBA-Alpha",
    });
  }
}
