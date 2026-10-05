import { AddressInfo } from "net";
import { io as connect, Socket } from "socket.io-client";
import request from "supertest";
import { app, httpServer } from "../src/index";
import { authAs } from "./helpers";
import { createUser } from "../src/users";
import { signToken } from "../src/middleware/auth";

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

function open(auth?: { token?: string }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { auth, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on("connect", () => resolve(s));
    s.on("connect_error", (err) => reject(err));
  });
}

describe("socket authentication", () => {
  it("rejects a connection without a token", async () => {
    await expect(open()).rejects.toThrow("Authentication required");
  });

  it("rejects a forged token", async () => {
    await expect(open({ token: "not-a-real-token" })).rejects.toThrow("Authentication required");
  });

  it("rejects an account that must change its password", async () => {
    const u = createUser({ email: "sock-pending@test.local", name: "P", password: "pending-password-2", role: "operator", mustChangePassword: true });
    await expect(open({ token: signToken(u) })).rejects.toThrow("Password change required");
  });

  it("accepts a valid token and delivers live incident events", async () => {
    const viewer = authAs("viewer");
    const operator = authAs("operator");
    const s = await open({ token: viewer.token });
    const received = new Promise<any>((resolve) => s.on("incident:created", resolve));
    await request(app).post("/api/incidents").set(operator.header).send({ title: "Live", description: "Socket event" });
    expect((await received).title).toBe("Live");
  });

  it("uses the signed-in identity for presence, not what the client claims", async () => {
    const op = authAs("operator", "Real Name");
    const s = await open({ token: op.token });
    const update = new Promise<any>((resolve) => s.on("presence:update", resolve));
    s.emit("user:join", { id: "spoofed-id", name: "Spoofed Name" });
    const names = (await update).onlineUsers.map((u: { name: string }) => u.name);
    expect(names).toContain("Real Name");
    expect(names).not.toContain("Spoofed Name");
  });
});
