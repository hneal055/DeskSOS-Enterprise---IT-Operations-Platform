// A low general API limit for this file only (config is read on first import)
process.env.RATE_LIMIT_API = "5";

import request from "supertest";
import { app } from "../src/index";

describe("general API rate limit", () => {
  it("returns 429 once a client exceeds the limit", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(app).get("/api/incidents")).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it("doesn't count or block ingest, which has its own allowance", async () => {
    const res = await request(app).post("/api/ingest/incidents").set("X-API-Key", "test-ingest-key")
      .send({ source: "rl", externalId: "rl-1", title: "t", description: "d" });
    expect(res.status).toBe(201);
  });

  it("doesn't limit the health check", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
  });
});
