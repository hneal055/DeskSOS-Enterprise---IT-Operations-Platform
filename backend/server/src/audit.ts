import { db } from "./db";
import { User } from "./users";

// Append-only history of who did what to each incident. Events are written
// in the same transaction as the change they describe, so history can't miss
// a change or record one that was rolled back.

export type IncidentAction = "created" | "ingested" | "status_changed" | "locked";

export interface Actor {
  userId: number | null;
  name: string;
  type: "user" | "integration";
}

export interface IncidentEvent {
  id: number;
  incidentId: number;
  action: IncidentAction;
  actor: Actor;
  details: Record<string, unknown>;
  createdAt: string;
}

interface EventRow {
  id: number;
  incident_id: number;
  action: IncidentAction;
  actor_user_id: number | null;
  actor_name: string;
  actor_type: "user" | "integration";
  details: string;
  created_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS incident_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id   INTEGER NOT NULL REFERENCES incidents(id),
    action        TEXT NOT NULL,
    actor_user_id INTEGER,
    actor_name    TEXT NOT NULL,
    actor_type    TEXT NOT NULL CHECK (actor_type IN ('user', 'integration')),
    details       TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS incident_events_by_incident ON incident_events (incident_id, id);
`);

export function actorFromUser(u: User): Actor {
  return { userId: u.id, name: u.name, type: "user" };
}

export function integrationActor(source: string): Actor {
  return { userId: null, name: source, type: "integration" };
}

export function recordEvent(
  incidentId: number,
  action: IncidentAction,
  actor: Actor,
  details: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO incident_events (incident_id, action, actor_user_id, actor_name, actor_type, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(incidentId, action, actor.userId, actor.name, actor.type, JSON.stringify(details), new Date().toISOString());
}

export function listEvents(incidentId: number): IncidentEvent[] {
  const rows = db
    .prepare("SELECT * FROM incident_events WHERE incident_id = ? ORDER BY id")
    .all(incidentId) as EventRow[];
  return rows.map((r) => ({
    id: r.id,
    incidentId: r.incident_id,
    action: r.action,
    actor: { userId: r.actor_user_id, name: r.actor_name, type: r.actor_type },
    details: JSON.parse(r.details),
    createdAt: r.created_at,
  }));
}

// Runs fn inside a database transaction (better-sqlite3 transactions are
// synchronous, so the change and its event commit or roll back together).
export function inTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
