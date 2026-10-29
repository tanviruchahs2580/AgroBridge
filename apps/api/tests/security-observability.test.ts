import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./helpers.js";

describe("Observability & security baseline", () => {
  it("/health responds without auth and reports the deployed commit when known", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Deployment verification (ci deploy-verify job) reads these; `commit` is
    // null when the runtime does not expose a SHA — never a fabricated value.
    expect(res.body).toHaveProperty("commit");
    expect(res.body.commit === null || /^[0-9a-f]{7}$/.test(res.body.commit)).toBe(true);
    expect(res.body.env).toBeDefined();
  });

  it("/ready checks database connectivity", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    // Assert the fields themselves: `?? true` made this pass when /ready
    // answered 200 without the connectivity verdict it exists to report.
    expect(res.body.db).toBe(true);
    expect(res.body.ready).toBe(true);
  });

  it("/ready reports the schema state and limiter store the release gate reads", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);

    // The deploy gate (deploy-verify.yml) fails when production's `schema.latest`
    // is behind the repository's newest migration — so the shape here is a
    // contract with CI, not decoration (ADR-0007).
    expect(res.body.schema).toBeTypeOf("object");
    expect(typeof res.body.schema.known).toBe("boolean");
    // The test database is built with `prisma migrate deploy`, so the migrations
    // table exists and the readout must be real rather than a silent unknown.
    expect(res.body.schema.known).toBe(true);
    expect(res.body.schema.applied).toBeGreaterThan(0);
    expect(typeof res.body.schema.latest).toBe("string");

    // "memory" is the honest answer in tests (no REDIS_URL); production is
    // allowed to report either, and says which.
    expect(["redis", "memory"]).toContain(res.body.limiterStore);

    // Storage durability is a release property (AUD-165): uploads on the
    // instance disk are lost on redeploy, so /ready must say which provider is
    // active and whether it is durable — and deploy-verify fails production
    // when the answer is `local` (ADR-0012).
    expect(res.body.storage).toBeTypeOf("object");
    expect(["local", "db", "s3", "unconfigured"]).toContain(res.body.storage.provider);
    expect(typeof res.body.storage.durable).toBe("boolean");
    expect(res.body.storage.durable).toBe(res.body.storage.provider !== "local" && res.body.storage.provider !== "unconfigured");
  });

  it("reports a migration that is genuinely in the chain, not a placeholder", async () => {
    const res = await request(app).get("/ready");
    const latest = res.body.schema?.latest ?? "";
    // Chain-latest must look like a Prisma migration directory name
    // (`20261018000000_hot_query_indexes`), because the gate compares it to one.
    expect(latest).toMatch(/^\d{14}_[a-z0-9_]+$/);
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
