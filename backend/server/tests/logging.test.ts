import { Writable } from "stream";
import winston from "winston";
import request from "supertest";
import { app } from "../src/index";
import { logger } from "../src/logger";
import { authAs } from "./helpers";
import { createUser } from "../src/users";

// Capture log entries as parsed JSON objects (production format)
const entries: any[] = [];
const sink = new Writable({
  write(chunk, _enc, done) {
    for (const line of chunk.toString().split("\n").filter(Boolean)) entries.push(JSON.parse(line));
    done();
  },
});
const capture = new winston.transports.Stream({
  stream: sink,
  level: "debug",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
});

beforeAll(() => {
  logger.silent = false;
  // Only the capture transport: keep the console quiet during tests
  logger.clear().add(capture);
});
beforeEach(() => { entries.length = 0; });
const flush = () => new Promise((r) => setImmediate(r));

const PASSWORD = "logging-test-password-1";
beforeAll(() => {
  createUser({ email: "logger@test.local", name: "Logger", password: PASSWORD, role: "operator" });
});

describe("request logs", () => {
  it("record method, path, status, duration and the signed-in user, without the query string", async () => {
    const op = authAs("operator", "Req Logger");
    await request(app).get("/api/incidents?secret=should-not-be-logged").set(op.header);
    await flush();
    const e = entries.find((x) => x.type === "request" && x.path === "/api/incidents");
    expect(e).toMatchObject({ level: "info", method: "GET", status: 200, user: op.user.email });
    expect(typeof e.durationMs).toBe("number");
    expect(typeof e.timestamp).toBe("string");
    expect(JSON.stringify(entries)).not.toContain("should-not-be-logged");
  });

  it("log anonymous 401s as warnings with no user", async () => {
    await request(app).get("/api/incidents");
    await flush();
    expect(entries.find((x) => x.type === "request" && x.status === 401)).toMatchObject({ level: "warn", user: null });
  });

  it("log health checks at debug level", async () => {
    await request(app).get("/health");
    await flush();
    expect(entries.find((x) => x.type === "request" && x.path === "/health")).toMatchObject({ level: "debug" });
  });

  it("log body-parser errors too (the logger runs first)", async () => {
    const op = authAs("operator");
    await request(app).post("/api/incidents").set(op.header).set("Content-Type", "application/json").send("{bad json");
    await flush();
    expect(entries.find((x) => x.type === "request" && x.status === 400)).toBeDefined();
  });
});

describe("audit events", () => {
  it("record successful and failed sign-ins, never the password", async () => {
    await request(app).post("/api/auth/login").send({ email: "logger@test.local", password: PASSWORD });
    await request(app).post("/api/auth/login").send({ email: "logger@test.local", password: "wrong-password-xyz" });
    await flush();
    expect(entries.find((x) => x.event === "auth.login")).toMatchObject({ type: "audit", user: "logger@test.local", role: "operator" });
    expect(entries.find((x) => x.event === "auth.login_failed")).toMatchObject({ level: "warn", email: "logger@test.local" });
    const all = JSON.stringify(entries);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("wrong-password-xyz");
  });

  it("record user management with who did it and what changed, never the temporary password", async () => {
    const admin = authAs("admin", "Audit Admin");
    const created = await request(app).post("/api/admin/users").set(admin.header)
      .send({ email: "audited@test.local", name: "Audited", role: "viewer" });
    await request(app).patch(`/api/admin/users/${created.body.user.id}`).set(admin.header).send({ role: "operator", active: false });
    const reset = await request(app).post(`/api/admin/users/${created.body.user.id}/reset-password`).set(admin.header).send({});
    await flush();
    expect(entries.find((x) => x.event === "user.created")).toMatchObject({ by: admin.user.email, target: "audited@test.local", role: "viewer" });
    expect(entries.find((x) => x.event === "user.updated")).toMatchObject({
      by: admin.user.email, target: "audited@test.local",
      changes: { role: { from: "viewer", to: "operator" }, active: { from: true, to: false } },
    });
    expect(entries.find((x) => x.event === "user.password_reset")).toMatchObject({ target: "audited@test.local" });
    const all = JSON.stringify(entries);
    expect(all).not.toContain(created.body.temporaryPassword);
    expect(all).not.toContain(reset.body.temporaryPassword);
  });

  it("record password changes, never the passwords", async () => {
    const { body } = await request(app).post("/api/auth/login").send({ email: "logger@test.local", password: PASSWORD });
    await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${body.token}`)
      .send({ currentPassword: PASSWORD, newPassword: "logging-test-password-2" });
    await flush();
    expect(entries.find((x) => x.event === "auth.password_changed")).toMatchObject({ user: "logger@test.local" });
    expect(JSON.stringify(entries)).not.toContain("logging-test-password-2");
  });

  it("never logs bearer tokens", async () => {
    const op = authAs("operator");
    await request(app).get("/api/incidents").set(op.header);
    await flush();
    expect(JSON.stringify(entries)).not.toContain(op.token);
  });
});
