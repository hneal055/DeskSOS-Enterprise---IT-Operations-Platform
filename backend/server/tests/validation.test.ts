import request from "supertest";
import { app } from "../src/index";
import { authAs } from "./helpers";

const op = authAs("operator").header;
const valid = { title: "Printer offline", description: "Floor 3 printer not responding" };

function create(body: object) {
  return request(app).post("/api/incidents").set(op).send(body);
}

describe("POST /api/incidents validation", () => {
  it("accepts a valid incident and trims text", async () => {
    const res = await create({ ...valid, title: "  Printer offline  ", severity: "HIGH", status: "In Progress" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Printer offline", severity: "HIGH", status: "In Progress" });
  });

  it("applies defaults for optional fields", async () => {
    const res = await create(valid);
    expect(res.body).toMatchObject({ severity: "MEDIUM", status: "Open", category: "Infrastructure", assignedTo: "Unassigned" });
  });

  it("lists every problem in one response", async () => {
    const res = await create({ title: "", description: 42, severity: "URGENT", status: "Done" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toEqual(expect.arrayContaining([
      expect.stringMatching(/^title:/),
      expect.stringMatching(/^description:/),
      expect.stringMatching(/^severity: must be one of CRITICAL, HIGH, MEDIUM, LOW/),
      expect.stringMatching(/^status: must be one of Open, In Progress, Resolved/),
    ]));
  });

  it("rejects whitespace-only text and overlong fields", async () => {
    expect((await create({ title: "   ", description: "x" })).status).toBe(400);
    expect((await create({ ...valid, title: "t".repeat(256) })).status).toBe(400);
    expect((await create({ ...valid, assignedTo: "a".repeat(101) })).status).toBe(400);
  });

  it("validates coordinates but treats unparseable ones (null) as not provided", async () => {
    expect((await create({ ...valid, location: { latitude: 91, longitude: 0 } })).status).toBe(400);
    const res = await create({ ...valid, location: { latitude: null, longitude: null } });
    expect(res.status).toBe(201);
    expect(res.body.location).toEqual({ latitude: 34.0522, longitude: -118.2437 });
  });

  it("ignores unknown fields such as a client-chosen source", async () => {
    const res = await create({ ...valid, source: "spoofed", id: 999999 });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("enterprise-ui");
    expect(res.body.id).not.toBe(999999);
  });
});

describe("PATCH /api/incidents/:id and lock validation", () => {
  let id: number;
  beforeAll(async () => { id = (await create(valid)).body.id; });

  it("only accepts known statuses", async () => {
    const res = await request(app).patch(`/api/incidents/${id}`).set(op).send({ status: "banana" });
    expect(res.status).toBe(400);
    expect((await request(app).patch(`/api/incidents/${id}`).set(op).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/incidents/${id}`).set(op).send({ status: "Resolved" })).status).toBe(200);
  });

  it("rejects non-numeric incident ids", async () => {
    const res = await request(app).patch("/api/incidents/abc").set(op).send({ status: "Open" });
    expect(res.status).toBe(400);
    expect(res.body.details[0]).toMatch(/^id:/);
    expect((await request(app).post("/api/incidents/-5/lock").set(op).send({})).status).toBe(400);
  });

  it("returns 404 when locking an incident that doesn't exist", async () => {
    expect((await request(app).post("/api/incidents/999999/lock").set(op).send({})).status).toBe(404);
  });
});

describe("auth body validation", () => {
  it("rejects missing or wrongly typed credentials with details", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: 123 });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.stringMatching(/^email:/), expect.stringMatching(/^password:/)]));
  });

  it("caps password length so huge strings aren't hashed", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "p".repeat(300) });
    expect(res.status).toBe(400);
  });
});
