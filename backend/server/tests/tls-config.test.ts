import path from "path";
import { checkTls, envFilesFor } from "../src/config";

describe("TLS settings", () => {
  it("accepts both paths or neither (outside production)", () => {
    expect(checkTls({ TLS_CERT_PATH: "c.crt", TLS_KEY_PATH: "k.key" })).toBeNull();
    expect(checkTls({})).toBeNull();
  });

  it("rejects only one of the two paths", () => {
    expect(checkTls({ TLS_CERT_PATH: "c.crt" })).toMatch(/both/);
    expect(checkTls({ TLS_KEY_PATH: "k.key" })).toMatch(/both/);
    expect(checkTls({ TLS_CERT_PATH: "  ", TLS_KEY_PATH: "k.key" })).toMatch(/both/);
  });

  it("requires HTTPS in production unless explicitly allowed", () => {
    expect(checkTls({ NODE_ENV: "production" })).toMatch(/production requires HTTPS/);
    expect(checkTls({ NODE_ENV: "production", ALLOW_HTTP_IN_PRODUCTION: "true" })).toBeNull();
    expect(checkTls({ NODE_ENV: "production", TLS_CERT_PATH: "c.crt", TLS_KEY_PATH: "k.key" })).toBeNull();
  });
});

describe("env files", () => {
  it("production loads .env.production before the shared .env (so its values win)", () => {
    const files = envFilesFor("production", "/srv").map((f) => path.basename(f));
    expect(files).toEqual([".env.production", ".env"]);
  });

  it("other environments load only .env", () => {
    expect(envFilesFor("development", "/srv").map((f) => path.basename(f))).toEqual([".env"]);
    expect(envFilesFor(undefined, "/srv").map((f) => path.basename(f))).toEqual([".env"]);
  });
});
