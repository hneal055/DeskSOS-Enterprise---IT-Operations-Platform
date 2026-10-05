import { Request, Response, NextFunction } from "express";
import { z, ZodTypeAny } from "zod";

// Validates (and normalizes) the request body and/or route params. On success
// the parsed values replace the originals, so handlers only ever see checked,
// trimmed data with unknown fields removed. On failure: 400 with a list of
// readable problems, the same shape the ingest route uses.
export function validate(schemas: { body?: ZodTypeAny; params?: ZodTypeAny }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const details: string[] = [];
    for (const part of ["params", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        (req as any)[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          const field = issue.path.join(".") || part;
          details.push(`${field}: ${issue.message}`);
        }
      }
    }
    if (details.length) return res.status(400).json({ error: "Validation failed", details });
    next();
  };
}

export { z };
