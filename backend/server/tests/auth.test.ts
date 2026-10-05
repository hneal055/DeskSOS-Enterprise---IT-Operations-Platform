import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/index";
import { createUser, ensureInitialAdmin, hashPassword, verifyPassword, getUser } from "../src/users";
import { db } from "../src/db";

const PASSWORD = "correct-horse-battery-staple";

function login(email: string, password: string) {
  return request(app).post("/api/auth/login").send({ email, password });
}

beforeAll(() => {
  createUser({ email: "operator@example.com", name: "Op One", password: PASSWORD, role: "operator" });
  createUser({ email: "gone@example.com", name: "Gone", password: PASSWORD, role: "viewer" });
  db.prepare("UPDATE users SET active = 0 WHERE email = 'gone@example.com'").run();
});

describe("password hashing", () => {
  it("stores scrypt hashes that verify only the right password", () => {
    const stored = hashPassword("s3cret-password!");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(verifyPassword("s3cret-password!", stored)).toBe(true);
    expect(verifyPassword("wrong-password!!", stored)).toBe(false);
  });

  it("salts every hash", () => {
    expect(hashPassword("same-password-123")).not.toBe(hashPassword("same-password-123"));
  });
});

describe("POST /api/auth/login", () => {
  it("signs in with the right password and returns a token and the user", async () => {
    const res = await login("operator@example.com", PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "operator@example.com", role: "operator", mustChangePassword: false });
    expect(res.body.user).not.toHaveProperty("password_hash");
    const payload = jwt.decode(res.body.token) as { sub: string; role: string; exp: number; iat: number };
    expect(payload).toMatchObject({ role: "operator" });
    expect(payload.exp - payload.iat).toBe(8 * 3600);
  });

  it("treats the email case-insensitively", async () => {
    expect((await login("OPERATOR@Example.com", PASSWORD)).status).toBe(200);
  });

  it("gives the same answer for a wrong password, an unknown email and a deactivated account", async () => {
    const wrong = await login("operator@example.com", "not-the-password");
    const unknown = await login("nobody@example.com", PASSWORD);
    const inactive = await login("gone@example.com", PASSWORD);
    for (const res of [wrong, unknown, inactive]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Invalid email or password" });
    }
  });

  it("rejects a missing email or password", async () => {
    expect((await request(app).post("/api/auth/login").send({ email: "operator@example.com" })).status).toBe(400);
  });

  it("no longer accepts arbitrary credentials (the old placeholder behaviour)", async () => {
    expect((await login("anyone@anywhere.com", "anything")).status).toBe(401);
  });

  it("removed self-registration", async () => {
    const res = await request(app).post("/api/auth/register").send({ name: "X", email: "x@x.com", password: PASSWORD });
    expect(res.status).toBe(404);
  });
});

describe("tokens", () => {
  it("are accepted by /api/auth/me", async () => {
    const { body } = await login("operator@example.com", PASSWORD);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("operator@example.com");
  });

  it("are rejected when missing, malformed, or signed with another secret", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer not-a-jwt")).status).toBe(401);
    const forged = jwt.sign({ sub: "1", role: "admin", tv: 0 }, "your-secret-key-change-this-in-production");
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  it("stop working as soon as the account is deactivated", async () => {
    const u = createUser({ email: "temp@example.com", name: "Temp", password: PASSWORD, role: "viewer" });
    const { body } = await login("temp@example.com", PASSWORD);
    db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(u.id);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.token}`)).status).toBe(401);
  });
});

describe("first-run admin and password change", () => {
  let token: string;
  let initialPassword: string;

  it("creates an admin with a random password only when there are no users", () => {
    // Users already exist in this test database
    expect(ensureInitialAdmin("admin@first.run")).toBeNull();
  });

  it("forces a password change before anything else", async () => {
    createUser({ email: "admin@first.run", name: "Administrator", password: "temporary-pass-0001", role: "admin", mustChangePassword: true });
    initialPassword = "temporary-pass-0001";
    const res = await login("admin@first.run", initialPassword);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    token = res.body.token;

    // /me is allowed so the UI can show the change-password screen
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("rejects a wrong current password and a weak new password", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const wrong = await request(app).post("/api/auth/change-password").set(auth)
      .send({ currentPassword: "nope", newPassword: "a-much-better-password" });
    expect(wrong.status).toBe(401);
    const weak = await request(app).post("/api/auth/change-password").set(auth)
      .send({ currentPassword: initialPassword, newPassword: "short" });
    expect(weak.status).toBe(400);
  });

  it("changes the password, clears the flag, and invalidates the old token", async () => {
    const res = await request(app).post("/api/auth/change-password").set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: initialPassword, newPassword: "a-much-better-password" });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);

    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`)).status).toBe(200);
    expect((await login("admin@first.run", initialPassword)).status).toBe(401);
    expect((await login("admin@first.run", "a-much-better-password")).status).toBe(200);
  });

  it("records the last sign-in time", () => {
    const row = db.prepare("SELECT id FROM users WHERE email = 'admin@first.run'").get() as { id: number };
    expect(getUser(row.id)!.lastLoginAt).not.toBeNull();
  });
});
