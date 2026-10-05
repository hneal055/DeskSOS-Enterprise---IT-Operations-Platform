import request from "supertest";
import { app } from "../src/index";
import { authAs } from "./helpers";
import { db } from "../src/db";
import * as audit from "../src/audit";

const olivia = authAs("operator", "Olivia Operator");
const adam = authAs("admin", "Adam Admin");
const vera = authAs("viewer", "Vera Viewer");

function history(id: number, h = vera.header) {
  return request(app).get(`/api/incidents/${id}/history`).set(h);
}

describe("incident history", () => {
  let id: number;

  it("records who created an incident", async () => {
    const res = await request(app).post("/api/incidents").set(olivia.header)
      .send({ title: "Disk full", description: "C: at 99%", severity: "HIGH" });
    id = res.body.id;
    const events = (await history(id)).body;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "created",
      actor: { userId: olivia.user.id, name: "Olivia Operator", type: "user" },
      details: { severity: "HIGH", status: "Open" },
    });
    expect(Date.parse(events[0].createdAt)).not.toBeNaN();
  });

  it("records status changes with from/to and the user, but not no-op updates", async () => {
    await request(app).patch(`/api/incidents/${id}`).set(adam.header).send({ status: "In Progress" });
    await request(app).patch(`/api/incidents/${id}`).set(adam.header).send({ status: "In Progress" }); // no change
    await request(app).patch(`/api/incidents/${id}`).set(olivia.header).send({ status: "Resolved" });
    const changes = (await history(id)).body.filter((e: any) => e.action === "status_changed");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ actor: { name: "Adam Admin" }, details: { from: "Open", to: "In Progress" } });
    expect(changes[1]).toMatchObject({ actor: { name: "Olivia Operator" }, details: { from: "In Progress", to: "Resolved" } });
  });

  it("records a lock when the holder changes, not on re-selection", async () => {
    const res = await request(app).post("/api/incidents").set(olivia.header).send({ title: "Lock me", description: "d" });
    const lid = res.body.id;
    await request(app).post(`/api/incidents/${lid}/lock`).set(olivia.header).send({});
    await request(app).post(`/api/incidents/${lid}/lock`).set(olivia.header).send({}); // same holder again
    const locks = (await history(lid)).body.filter((e: any) => e.action === "locked");
    expect(locks).toHaveLength(1);
    expect(locks[0].actor.name).toBe("Olivia Operator");
  });

  it("records ingested Desktop tickets with the integration as the actor", async () => {
    const res = await request(app).post("/api/ingest/incidents").set("X-API-Key", "test-ingest-key")
      .send({ source: "desksos-desktop", externalId: "T-AUDIT-1", title: "VPN down", description: "d", requester: "jdoe" });
    const events = (await history(res.body.id)).body;
    expect(events).toEqual([
      expect.objectContaining({
        action: "ingested",
        actor: { userId: null, name: "desksos-desktop", type: "integration" },
        details: expect.objectContaining({ externalId: "T-AUDIT-1", requester: "jdoe" }),
      }),
    ]);
  });

  it("an ingest retry doesn't add a second event", async () => {
    const send = () => request(app).post("/api/ingest/incidents").set("X-API-Key", "test-ingest-key")
      .send({ source: "desksos-desktop", externalId: "T-AUDIT-2", title: "t", description: "d" });
    const first = await send();
    await send();
    expect((await history(first.body.id)).body).toHaveLength(1);
  });

  it("failed changes leave no event (rejected by validation or permissions)", async () => {
    const before = (await history(id)).body.length;
    await request(app).patch(`/api/incidents/${id}`).set(olivia.header).send({ status: "banana" });
    await request(app).patch(`/api/incidents/${id}`).set(vera.header).send({ status: "Open" });
    expect((await history(id)).body).toHaveLength(before);
  });

  it("is readable by any signed-in role but not anonymously, and 404s for unknown incidents", async () => {
    expect((await history(id, vera.header)).status).toBe(200);
    expect((await request(app).get(`/api/incidents/${id}/history`)).status).toBe(401);
    expect((await history(999999)).status).toBe(404);
  });

  it("if the event can't be written, the change is rolled back too", async () => {
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM incidents").get() as { n: number }).n;
    const before = count();
    const spy = jest.spyOn(audit, "recordEvent").mockImplementation(() => { throw new Error("disk full"); });
    try {
      const res = await request(app).post("/api/incidents").set(olivia.header).send({ title: "Rollback", description: "d" });
      expect(res.status).toBe(500);
      expect(res.body.error).not.toMatch(/disk full/); // internal detail not leaked
    } finally {
      spy.mockRestore();
    }
    expect(count()).toBe(before);
  });
});
