import request from "supertest";
import { app } from "../src/index";
import { authAs } from "./helpers";

const KEY = "test-ingest-key";
const op = authAs("operator").header;

const desktopTicket = {
  source: "desksos-desktop",
  externalId: "T-12345678",
  title: "[PC-01] Cannot reach shared drive",
  description: "DESKSOS DIAGNOSTIC REPORT\n...",
  severity: "HIGH",
  requester: "jdoe",
};

describe("GET /health", () => {
  it("reports the database as connected", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.services.database).toBe("connected");
  });
});

describe("Enterprise UI incidents", () => {
  it("creates, lists and updates an incident", async () => {
    const created = await request(app)
      .post("/api/incidents")
      .set(op)
      .send({ title: "Disk full on file server", description: "C: at 99%", severity: "CRITICAL" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ severity: "CRITICAL", status: "Open", source: "enterprise-ui" });
    expect(typeof created.body.created_at).toBe("string");

    const list = await request(app).get("/api/incidents").set(op);
    expect(list.body.some((i: { id: number }) => i.id === created.body.id)).toBe(true);

    const patched = await request(app).patch(`/api/incidents/${created.body.id}`).set(op).send({ status: "Resolved" });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe("Resolved");
  });

  it("rejects an incident without a description", async () => {
    const res = await request(app).post("/api/incidents").set(op).send({ title: "No description" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when updating an unknown incident", async () => {
    const res = await request(app).patch("/api/incidents/999999").set(op).send({ status: "Resolved" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/ingest/incidents", () => {
  it("rejects requests without the API key", async () => {
    const res = await request(app).post("/api/ingest/incidents").send(desktopTicket);
    expect(res.status).toBe(401);
  });

  it("rejects a wrong API key", async () => {
    const res = await request(app).post("/api/ingest/incidents").set("X-API-Key", "wrong").send(desktopTicket);
    expect(res.status).toBe(401);
  });

  it("creates an incident linked to the external ticket", async () => {
    const res = await request(app).post("/api/ingest/incidents").set("X-API-Key", KEY).send(desktopTicket);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      source: "desksos-desktop",
      externalId: "T-12345678",
      requester: "jdoe",
      severity: "HIGH",
      category: "Desktop Support",
      status: "Open",
    });
  });

  it("is idempotent: a retry returns the same incident with 200", async () => {
    const first = await request(app).get("/api/incidents").set(op);
    const before = first.body.length;

    const retry = await request(app).post("/api/ingest/incidents").set("X-API-Key", KEY).send(desktopTicket);
    expect(retry.status).toBe(200);
    expect(retry.body.externalId).toBe("T-12345678");

    const after = await request(app).get("/api/incidents").set(op);
    expect(after.body.length).toBe(before);
  });

  it("validates required fields and severity", async () => {
    const res = await request(app)
      .post("/api/ingest/incidents")
      .set("X-API-Key", KEY)
      .send({ source: "desksos-desktop", title: "x", severity: "URGENT" });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining(["externalId is required", "description is required", expect.stringMatching(/^severity/)])
    );
  });

  it("persists ingested incidents", async () => {
    const list = await request(app).get("/api/incidents").set(op);
    const found = list.body.find((i: { externalId: string }) => i.externalId === "T-12345678");
    expect(found).toBeDefined();
    expect(found.title).toBe(desktopTicket.title);
  });
});
