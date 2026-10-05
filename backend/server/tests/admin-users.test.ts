import request from "supertest";
import { app } from "../src/index";
import { authAs } from "./helpers";

const admin = authAs("admin", "Main Admin");
const A = admin.header;

function login(email: string, password: string) {
  return request(app).post("/api/auth/login").send({ email, password });
}

describe("access", () => {
  it("is limited to admins", async () => {
    for (const role of ["operator", "viewer"] as const) {
      const h = authAs(role).header;
      expect((await request(app).get("/api/admin/users").set(h)).status).toBe(403);
      expect((await request(app).post("/api/admin/users").set(h).send({ email: "x@y.z", name: "X", role: "admin" })).status).toBe(403);
    }
    expect((await request(app).get("/api/admin/users")).status).toBe(401);
  });

  it("lists users without exposing password hashes", async () => {
    const res = await request(app).get("/api/admin/users").set(A);
    expect(res.status).toBe(200);
    expect(res.body.find((u: any) => u.email === admin.user.email)).toMatchObject({ role: "admin", active: true });
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|scrypt\$/);
  });
});

describe("onboarding a user", () => {
  let tempPassword: string;
  let userId: number;

  it("creates the user with a one-time temporary password", async () => {
    const res = await request(app).post("/api/admin/users").set(A)
      .send({ email: "  New.Operator@Example.com ", name: "New Operator", role: "operator" });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "new.operator@example.com", role: "operator", mustChangePassword: true });
    expect(res.body.temporaryPassword).toHaveLength(24);
    tempPassword = res.body.temporaryPassword;
    userId = res.body.user.id;
  });

  it("the new user signs in with it and must choose their own password", async () => {
    const res = await login("new.operator@example.com", tempPassword);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    const changed = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${res.body.token}`)
      .send({ currentPassword: tempPassword, newPassword: "operator-own-password" });
    expect(changed.status).toBe(200);
  });

  it("rejects duplicates (case-insensitive) and invalid input", async () => {
    const dup = await request(app).post("/api/admin/users").set(A).send({ email: "NEW.operator@example.com", name: "Dup", role: "viewer" });
    expect(dup.status).toBe(409);
    const bad = await request(app).post("/api/admin/users").set(A).send({ email: "not-an-email", name: "", role: "superuser" });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toEqual(expect.arrayContaining([
      expect.stringMatching(/^email:/), expect.stringMatching(/^name:/), expect.stringMatching(/^role:/),
    ]));
  });

  it("role changes take effect immediately and end existing sessions", async () => {
    const session = (await login("new.operator@example.com", "operator-own-password")).body.token;
    const res = await request(app).patch(`/api/admin/users/${userId}`).set(A).send({ role: "viewer" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("viewer");
    expect((await request(app).get("/api/incidents").set("Authorization", `Bearer ${session}`)).status).toBe(401);
    const fresh = (await login("new.operator@example.com", "operator-own-password")).body.token;
    expect((await request(app).post("/api/incidents").set("Authorization", `Bearer ${fresh}`)
      .send({ title: "t", description: "d" })).status).toBe(403);
  });

  it("deactivation blocks sign-in; reactivation restores it", async () => {
    expect((await request(app).patch(`/api/admin/users/${userId}`).set(A).send({ active: false })).status).toBe(200);
    expect((await login("new.operator@example.com", "operator-own-password")).status).toBe(401);
    expect((await request(app).patch(`/api/admin/users/${userId}`).set(A).send({ active: true })).status).toBe(200);
    expect((await login("new.operator@example.com", "operator-own-password")).status).toBe(200);
  });

  it("password reset issues a new temporary password and ends sessions", async () => {
    const session = (await login("new.operator@example.com", "operator-own-password")).body.token;
    const res = await request(app).post(`/api/admin/users/${userId}/reset-password`).set(A).send({});
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${session}`)).status).toBe(401);
    expect((await login("new.operator@example.com", "operator-own-password")).status).toBe(401);
    expect((await login("new.operator@example.com", res.body.temporaryPassword)).status).toBe(200);
  });

  it("returns 404 for unknown users and 400 for empty updates", async () => {
    expect((await request(app).patch("/api/admin/users/999999").set(A).send({ active: false })).status).toBe(404);
    expect((await request(app).post("/api/admin/users/999999/reset-password").set(A).send({})).status).toBe(404);
    expect((await request(app).patch(`/api/admin/users/${userId}`).set(A).send({})).status).toBe(400);
  });
});

describe("safeguards", () => {
  it("admins can't deactivate or demote themselves", async () => {
    const self = admin.user.id;
    const off = await request(app).patch(`/api/admin/users/${self}`).set(A).send({ active: false });
    expect(off.status).toBe(400);
    const demote = await request(app).patch(`/api/admin/users/${self}`).set(A).send({ role: "viewer" });
    expect(demote.status).toBe(400);
  });

  it("a sole remaining admin can't remove admin access from the system", async () => {
    // One admin demotes the other (allowed: one active admin remains)...
    const second = authAs("admin", "Second Admin");
    expect((await request(app).patch(`/api/admin/users/${admin.user.id}`).set(second.header).send({ role: "operator" })).status).toBe(200);
    // ...and the remaining admin can't deactivate or demote themselves
    expect((await request(app).patch(`/api/admin/users/${second.user.id}`).set(second.header).send({ active: false })).status).toBe(400);
    expect((await request(app).patch(`/api/admin/users/${second.user.id}`).set(second.header).send({ role: "viewer" })).status).toBe(400);
    const list = await request(app).get("/api/admin/users").set(second.header);
    expect(list.body.filter((u: any) => u.role === "admin" && u.active)).toHaveLength(1);
  });
});
