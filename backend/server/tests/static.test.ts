// Serving the built dashboard from the backend (plan task 2.2). A tiny fake
// build is created before the app is imported (config is read on import).
import fs from "fs";
import os from "os";
import path from "path";

const build = fs.mkdtempSync(path.join(os.tmpdir(), "desksos-build-"));
fs.mkdirSync(path.join(build, "assets"));
fs.writeFileSync(path.join(build, "index.html"), "<!doctype html><div id=root></div><script type=module src=/assets/app-abc123.js></script>");
fs.writeFileSync(path.join(build, "assets", "app-abc123.js"), "console.log('app')");
fs.writeFileSync(path.join(build, "favicon.ico"), "icon");
process.env.SERVE_CLIENT = "true";
process.env.CLIENT_BUILD_PATH = build;

import request from "supertest";
import { app } from "../src/index";

describe("dashboard served by the backend", () => {
  it("serves index.html at / without caching", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('<div id=root>');
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets with a long, immutable cache", async () => {
    const res = await request(app).get("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/max-age=31536000.*immutable/);
  });

  it("returns 404 for a missing asset instead of the page", async () => {
    expect((await request(app).get("/assets/missing.js")).status).toBe(404);
  });

  it("serves other static files from the build root", async () => {
    expect((await request(app).get("/favicon.ico")).status).toBe(200);
  });

  it("returns index.html for client-side routes", async () => {
    const res = await request(app).get("/users/some/deep/link");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id=root>');
  });

  it("keeps the API, health check and auth behaviour intact", async () => {
    const unknown = await request(app).get("/api/no-such-route");
    expect(unknown.status).toBe(404);
    expect(unknown.headers["content-type"]).toMatch(/json/);
    expect((await request(app).get("/api/incidents")).status).toBe(401);
    expect((await request(app).get("/health")).body.status).toBe("ok");
    expect((await request(app).get("/api")).body.message).toMatch(/API Server/);
  });

  it("sends a CSP that allows the dashboard but not inline scripts or other origins", async () => {
    const csp = (await request(app).get("/")).headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    // Plain HTTP until task 2.3, so browsers must not be told to upgrade
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
