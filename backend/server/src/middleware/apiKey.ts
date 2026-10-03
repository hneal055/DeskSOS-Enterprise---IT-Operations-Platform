import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import config from "../config";

// Machine-to-machine auth: the caller sends the shared INGEST_API_KEY in the
// X-API-Key header. Compared in constant time; ingest is off while unset.
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!config.ingestApiKey) {
    return res.status(503).json({ error: "Ingest is disabled: INGEST_API_KEY is not configured" });
  }
  const provided = req.get("x-api-key") || "";
  const expected = Buffer.from(config.ingestApiKey);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }
  next();
}
