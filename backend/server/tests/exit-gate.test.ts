// Phase 1 exit gate: an independent check that finds every route Express has
// registered (rather than trusting a hand-written list) and proves each one
// refuses a request without a valid token, apart from an explicit allowlist.
import request from "supertest";
import { app } from "../src/index";

// Routes that are open by design, and why
const OPEN_BY_DESIGN: Record<string, string> = {
  "GET /": "API info only, no data (the dashboard page when SERVE_CLIENT is on)",
  "GET /api": "API info only, no data",
  "GET /health": "uptime monitoring",
  "POST /api/auth/login": "how you get a token (rate limited)",
  "POST /api/auth/logout": "stateless no-op, returns 204",
};

interface Route { method: string; path: string }

// Turns an Express 4 mount regexp like /^\/api\/incidents\/?(?=\/|$)/i into "/api/incidents"
function mountPath(layer: any): string {
  if (layer.regexp?.fast_slash) return "";
  const src: string = layer.regexp?.source ?? "";
  return src.replace("^", "").replace("\\/?(?=\\/|$)", "").replace(/\\\//g, "/");
}

function collect(stack: any[], prefix = ""): Route[] {
  const routes: Route[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        const full = (prefix + layer.route.path).replace(/(.)\/$/, "$1"); // "/api/incidents/" -> "/api/incidents"
        routes.push({ method: method.toUpperCase(), path: full });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      routes.push(...collect(layer.handle.stack, prefix + mountPath(layer)));
    }
  }
  return routes;
}

const discovered = collect((app as any)._router.stack);
const concrete = (p: string) => p.replace(/:[^/]+/g, "1"); // fill route params

describe("Phase 1 exit gate: no open endpoints", () => {
  it("discovers the app's routes (sanity check)", () => {
    const keys = discovered.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(expect.arrayContaining([
      "GET /api/incidents", "PATCH /api/incidents/:id", "GET /api/admin/users", "POST /api/ingest/incidents",
    ]));
    expect(discovered.length).toBeGreaterThanOrEqual(20);
  });

  it.each(discovered.map((r) => [r.method, r.path]))(
    "%s %s refuses anonymous requests unless open by design",
    async (method, path) => {
      const res = await (request(app) as any)[method.toLowerCase()](concrete(path)).send({});
      const key = `${method} ${path}`;
      if (key in OPEN_BY_DESIGN) {
        expect(res.status).not.toBe(401);
      } else {
        // 401 for sign-in routes; ingest also answers 401 without its API key
        expect(res.status).toBe(401);
      }
    }
  );

  it("every allowlisted route actually exists (the allowlist can't hide typos)", () => {
    const keys = new Set(discovered.map((r) => `${r.method} ${r.path}`));
    for (const key of Object.keys(OPEN_BY_DESIGN)) expect(keys.has(key)).toBe(true);
  });
});
