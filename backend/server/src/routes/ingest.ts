import { Router, Request, Response } from "express";
import { requireApiKey } from "../middleware/apiKey";
import { createIncident, findByExternalId, SEVERITIES, Severity } from "../db";
import { inTransaction, integrationActor, recordEvent } from "../audit";

const router = Router();

const MAX_TITLE = 255;
const MAX_DESCRIPTION = 20000;
const MAX_SHORT = 200;

function optionalString(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

// POST /api/ingest/incidents
// Machine-to-machine intake, e.g. tickets forwarded by the DeskSOS Desktop
// backend. Idempotent on (source, externalId): a retry returns the existing
// incident with 200 instead of creating a duplicate.
router.post("/incidents", requireApiKey, (req: Request, res: Response) => {
  const { source, externalId, title, description, severity, category, requester, assignedTo, location } =
    req.body ?? {};

  const errors: string[] = [];
  if (typeof source !== "string" || !source.trim()) errors.push("source is required");
  if (typeof externalId !== "string" || !externalId.trim()) errors.push("externalId is required");
  if (typeof title !== "string" || !title.trim()) errors.push("title is required");
  if (typeof description !== "string" || !description.trim()) errors.push("description is required");
  if (severity !== undefined && !SEVERITIES.includes(severity)) {
    errors.push(`severity must be one of ${SEVERITIES.join(", ")}`);
  }
  if (errors.length) return res.status(400).json({ error: "Validation failed", details: errors });

  const src = source.trim().slice(0, MAX_SHORT);
  const extId = externalId.trim().slice(0, MAX_SHORT);

  const existing = findByExternalId(src, extId);
  if (existing) return res.status(200).json(existing);

  const lat = Number(location?.latitude);
  const lon = Number(location?.longitude);
  const incident = inTransaction(() => {
    const created = createIncident({
      title: title.trim().slice(0, MAX_TITLE),
      description: description.trim().slice(0, MAX_DESCRIPTION),
      severity: (severity as Severity) ?? "MEDIUM",
      category: optionalString(category, MAX_SHORT) ?? "Desktop Support",
      requester: optionalString(requester, MAX_SHORT) ?? null,
      assignedTo: optionalString(assignedTo, MAX_SHORT),
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lon) ? lon : undefined,
      source: src,
      externalId: extId,
    });
    recordEvent(created.id, "ingested", integrationActor(src), {
      externalId: extId, requester: created.requester, severity: created.severity,
    });
    return created;
  });

  req.app.get("io")?.emit("incident:created", incident);
  res.status(201).json(incident);
});

export default router;
