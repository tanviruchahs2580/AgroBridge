import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./helpers.js";

describe("Observability — Metrics", () => {
  it("GET /metrics exposes prometheus format", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("agrobridge_http_requests_total");
    expect(res.text).toContain("agrobridge_db_up");
  });

  it("GET /ready sets db_up metric", async () => {
    const ready = await request(app).get("/ready");
    expect([200, 503]).toContain(ready.status);
    const metrics = await request(app).get("/metrics");
    expect(metrics.text).toMatch(/agrobridge_db_up\s[01]/);
  });
});
