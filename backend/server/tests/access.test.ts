import request from "supertest";
import { app } from "../src/index";
import { authAs } from "./helpers";
import { createUser } from "../src/users";
import { signToken } from "../src/middleware/auth";

// Every route under the protected prefixes. If a route is added without being
// listed here it is still protected (auth is applied where routers are
// mounted); this list makes the guarantee visible and tested.
const PROTECTED: Array<[string, string]> = [
  ["get", "/api/incidents"],
  ["post", "/api/incidents"],
  ["patch", "/api/incidents/1"],
  ["post", "/api/incidents/1/lock"],
  ["get", "/api/incidents/1/history"],
  ["get", "/api/dashboard"],
  ["get", "/api/dashboard/metrics"],
  ["get", "/api/chat/channels"],
  ["get", "/api/chat/channels/channel-1/messages"],
  ["get", "/api/user/me"],
  ["get", "/api/auth/me"],
  ["post", "/api/auth/change-password"],
  ["get", "/api/admin/users"],
  ["post", "/api/admin/users"],
  ["patch", "/api/admin/users/1"],
  ["post", "/api/admin/users/1/reset-password"],
];

function call(method: string, path: string) {
  return (request(app) as any)[method](path);
}

describe("every protected route requires sign-in", () => {
  it.each(PROTECTED)("%s %s -> 401 without a token", async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
  });

  it.each(PROTECTED)("%s %s -> 401 with a forged token", async (method, path) => {
    const res = await call(method, path).set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.forged").send({});
    expect(res.status).toBe(401);
  });

  it("an account with a pending password change is limited to /me and change-password", async () => {
    const u = createUser({ email: "pending@test.local", name: "Pending", password: "pending-password-1", role: "admin", mustChangePassword: true });
    const h = { Authorization: `Bearer ${signToken(u)}` };
    expect((await request(app).get("/api/incidents").set(h)).status).toBe(403);
    expect((await request(app).get("/api/auth/me").set(h)).status).toBe(200);
  });
});

describe("open routes stay open", () => {
  it("health check", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
  });
  it("login", async () => {
    expect((await request(app).post("/api/auth/login").send({ email: "x@y.z", password: "nope" })).status).toBe(401);
  });
  it("ingest uses its API key, not sign-in", async () => {
    const res = await request(app).post("/api/ingest/incidents").set("X-API-Key", "test-ingest-key")
      .send({ source: "s", externalId: "e-access", title: "t", description: "d" });
    expect(res.status).toBe(201);
  });
});

describe("roles", () => {
  const viewer = authAs("viewer");
  const operator = authAs("operator", "Olivia Operator");
  const admin = authAs("admin");
  const incident = { title: "Role test", description: "Checking permissions" };

  it("viewers can read incidents but not change them", async () => {
    expect((await request(app).get("/api/incidents").set(viewer.header)).status).toBe(200);
    expect((await request(app).post("/api/incidents").set(viewer.header).send(incident)).status).toBe(403);
    expect((await request(app).patch("/api/incidents/1").set(viewer.header).send({ status: "Resolved" })).status).toBe(403);
    expect((await request(app).post("/api/incidents/1/lock").set(viewer.header).send({})).status).toBe(403);
  });

  it("operators and admins can create and update incidents", async () => {
    for (const who of [operator, admin]) {
      const created = await request(app).post("/api/incidents").set(who.header).send(incident);
      expect(created.status).toBe(201);
      const patched = await request(app).patch(`/api/incidents/${created.body.id}`).set(who.header).send({ status: "In Progress" });
      expect(patched.status).toBe(200);
    }
  });

  it("locks are taken in the signed-in user's name, whatever name is sent", async () => {
    const created = await request(app).post("/api/incidents").set(operator.header).send(incident);
    const res = await request(app).post(`/api/incidents/${created.body.id}/lock`).set(operator.header)
      .send({ operatorName: "Someone Else" });
    expect(res.status).toBe(200);
    expect(res.body.lockedBy).toBe("Olivia Operator");
  });

  it("/api/user/me returns the real signed-in user", async () => {
    const res = await request(app).get("/api/user/me").set(viewer.header);
    expect(res.body.data).toMatchObject({ email: viewer.user.email, role: "viewer" });
  });
});
