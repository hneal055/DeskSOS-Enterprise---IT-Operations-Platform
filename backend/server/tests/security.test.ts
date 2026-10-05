// A low sign-in limit for this file only, so the limiter can be exercised
// quickly (config is read when the app is first imported).
process.env.RATE_LIMIT_LOGIN = "3";

import request from "supertest";
import { app } from "../src/index";
import { createUser } from "../src/users";
import { authAs } from "./helpers";

beforeAll(() => {
  createUser({ email: "limited@test.local", name: "Limited", password: "limited-password-1", role: "operator" });
});

describe("security headers", () => {
  it("are present on API responses and X-Powered-By is gone", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("are present on error responses too", async () => {
    const res = await request(app).get("/api/incidents");
    expect(res.status).toBe(401);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("CORS", () => {
  it("allows the configured dashboard origin", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:3000");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("does not allow other origins", async () => {
    const res = await request(app).get("/health").set("Origin", "http://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("sign-in rate limit", () => {
  const attempt = (email: string, password: string) =>
    request(app).post("/api/auth/login").send({ email, password });

  it("blocks an account after repeated failures", async () => {
    for (let i = 0; i < 3; i++) expect((await attempt("limited@test.local", "wrong")).status).toBe(401);
    const blocked = await attempt("limited@test.local", "wrong");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many failed sign-in attempts/);
    expect(blocked.headers["ratelimit-policy"]).toBeDefined();
    // Even the right password is refused until the window passes
    expect((await attempt("limited@test.local", "limited-password-1")).status).toBe(429);
  });

  it("counts failures per account, so other users can still sign in", async () => {
    createUser({ email: "other@test.local", name: "Other", password: "other-password-12", role: "viewer" });
    expect((await attempt("other@test.local", "other-password-12")).status).toBe(200);
  });

  it("doesn't count successful sign-ins", async () => {
    createUser({ email: "frequent@test.local", name: "Frequent", password: "frequent-password", role: "viewer" });
    for (let i = 0; i < 5; i++) expect((await attempt("frequent@test.local", "frequent-password")).status).toBe(200);
  });
});

describe("request body limits and errors", () => {
  const op = authAs("operator").header;

  it("rejects oversized bodies with 413", async () => {
    const res = await request(app).post("/api/incidents").set(op)
      .send({ title: "big", description: "x".repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("Request body is too large");
  });

  it("rejects malformed JSON with a plain 400", async () => {
    const res = await request(app).post("/api/incidents").set(op)
      .set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Request body is not valid JSON");
  });
});
