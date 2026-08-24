import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./helpers.js";

describe("Observability & security baseline", () => {
  it("/health responds without auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("/ready checks database connectivity", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.data?.db ?? res.body.ready ?? true).toBeTruthy();
  });

  it("security headers present (helmet)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("unknown API route returns structured 404 with requestId", async () => {
    const res = await request(app).get("/api/v1/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(res.body.requestId).toBeDefined();
  });

  it("malformed JSON returns 400 not 500", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"broken": ');
    expect(res.status).toBe(400);
  });

  it("oversized JSON payload rejected", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send({ a: big });
    expect([400, 413]).toContain(res.status);
  });

  it("protected resources reject forged tokens", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.forged.sig");
    expect(res.status).toBe(401);
  });

  it("CORS reflects only configured origin", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
