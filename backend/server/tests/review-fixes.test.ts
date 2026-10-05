// Regression tests for the CodeRabbit findings on PR #11
import { AddressInfo } from "net";
import { io as connect, Socket } from "socket.io-client";
import request from "supertest";
import { app, httpServer } from "../src/index";
import { authAs } from "./helpers";
import { createUser, verifyPassword } from "../src/users";
import * as audit from "../src/audit";
import { db } from "../src/db";

let url: string;
const sockets: Socket[] = [];

beforeAll((done) => {
  httpServer.listen(0, () => {
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
    done();
  });
});
afterAll((done) => {
  sockets.forEach((s) => s.close());
  httpServer.close(() => done());
});

function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
const disconnected = (s: Socket) => new Promise<string>((resolve) => s.on("disconnect", resolve));

describe("revoking a session closes the user's open live connections", () => {
  const admin = authAs("admin", "Revoker");

  it("on deactivation", async () => {
    const leaver = authAs("operator", "Leaver");
    const s = await open(leaver.token);
    const gone = disconnected(s);
    await request(app).patch(`/api/admin/users/${leaver.user.id}`).set(admin.header).send({ active: false });
    expect(await gone).toBe("io server disconnect");
    // And it can't come back with the old token
    await expect(open(leaver.token)).rejects.toThrow("Authentication required");
  });

  it("on a role change", async () => {
    const u = authAs("operator", "Demoted");
    const s = await open(u.token);
    const gone = disconnected(s);
    await request(app).patch(`/api/admin/users/${u.user.id}`).set(admin.header).send({ role: "viewer" });
    expect(await gone).toBe("io server disconnect");
  });

  it("on an admin password reset", async () => {
    const u = authAs("viewer", "Reset Me");
    const s = await open(u.token);
    const gone = disconnected(s);
    await request(app).post(`/api/admin/users/${u.user.id}/reset-password`).set(admin.header).send({});
    expect(await gone).toBe("io server disconnect");
  });

  it("on the user's own password change, while the new token can reconnect", async () => {
    createUser({ email: "self-change@test.local", name: "Self", password: "self-change-pass-1", role: "operator" });
    const { body } = await request(app).post("/api/auth/login").send({ email: "self-change@test.local", password: "self-change-pass-1" });
    const s = await open(body.token);
    const gone = disconnected(s);
    const changed = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${body.token}`)
      .send({ currentPassword: "self-change-pass-1", newPassword: "self-change-pass-2" });
    expect(await gone).toBe("io server disconnect");
    await expect(open(body.token)).rejects.toThrow("Authentication required");
    await expect(open(changed.body.token)).resolves.toBeDefined();
  });

  it("doesn't disconnect anyone when nothing about the session changed (name only)", async () => {
    const u = authAs("viewer", "Renamed");
    const s = await open(u.token);
    let dropped = false;
    s.on("disconnect", () => { dropped = true; });
    await request(app).patch(`/api/admin/users/${u.user.id}`).set(admin.header).send({ name: "Renamed Again" });
    await new Promise((r) => setTimeout(r, 200));
    expect(dropped).toBe(false);
  });
});

describe("admins can't reset their own password from user management", () => {
  it("returns 400 and leaves the session intact", async () => {
    const admin = authAs("admin", "Self Resetter");
    const res = await request(app).post(`/api/admin/users/${admin.user.id}/reset-password`).set(admin.header).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Change password/);
    expect((await request(app).get("/api/auth/me").set(admin.header)).status).toBe(200);
  });
});

describe("malformed stored password hashes fail closed", () => {
  it("returns false instead of throwing for out-of-range or broken parameters", () => {
    const salt = Buffer.alloc(16).toString("base64");
    const hash = Buffer.alloc(64).toString("base64");
    for (const stored of [
      `scrypt$1000$8$1$${salt}$${hash}`,      // N not a power of two
      `scrypt$1073741824$8$1$${salt}$${hash}`, // N absurdly large
      `scrypt$32768$999$1$${salt}$${hash}`,    // r out of range
      `scrypt$32768$8$1$${salt}$AA==`,         // key too short
      "garbage", "",
    ]) {
      expect(() => verifyPassword("anything-at-all", stored)).not.toThrow();
      expect(verifyPassword("anything-at-all", stored)).toBe(false);
    }
  });

  it("a corrupt row makes login answer 401, not 500", async () => {
    createUser({ email: "corrupt@test.local", name: "Corrupt", password: "corrupt-password-1", role: "viewer" });
    db.prepare("UPDATE users SET password_hash = 'scrypt$1000$8$1$AAAA$BBBB' WHERE email = 'corrupt@test.local'").run();
    const res = await request(app).post("/api/auth/login").send({ email: "corrupt@test.local", password: "corrupt-password-1" });
    expect(res.status).toBe(401);
  });
});

describe("a failed status update keeps the incident locked", () => {
  it("doesn't release the lock when the change rolls back", async () => {
    const op = authAs("operator", "Lock Keeper");
    const created = await request(app).post("/api/incidents").set(op.header).send({ title: "Keep lock", description: "d" });
    const id = created.body.id;
    await request(app).post(`/api/incidents/${id}/lock`).set(op.header).send({});

    const spy = jest.spyOn(audit, "recordEvent").mockImplementation(() => { throw new Error("boom"); });
    try {
      const res = await request(app).patch(`/api/incidents/${id}`).set(op.header).send({ status: "Resolved" });
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    const list = await request(app).get("/api/incidents").set(op.header);
    const inc = list.body.find((i: any) => i.id === id);
    expect(inc.status).toBe("Open");
    expect(inc.lockedBy).toBe("Lock Keeper");
  });
});
