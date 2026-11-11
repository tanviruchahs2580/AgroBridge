import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { app } from "./helpers.js";
import { registry, requestsShedTotal, mountedPrefixFor } from "../src/infrastructure/metrics.js";
import { getHealthRegistry, markDegraded, markDown } from "../src/providers/health.js";

/**
 * Observability fixes that "actually fire" (F-26, F-28, F-71, F-73).
 *
 * F-26: the HTTP metric labelled every pre-handler refusal `route="unmatched"`,
 * so a 401/403/429 on a real endpoint was unattributable. The label now falls
 * back to the mount prefix.
 * F-71: admission shedding was a log line; it now increments a counter.
 * F-28: the provider-health registry the AI gateway writes was read by nothing;
 * it is now exposed as a gauge and seeded at app construction.
 * F-73: a body-parser rejection skips middleware that runs after the parser —
 * including requestContext — so the error response must still carry a
 * correlation id.
 */
describe("HTTP metrics attribute refusals to the mounted route (F-26)", () => {
  it("the mount table knows the real mounts and is longest-prefix first", () => {
    expect(mountedPrefixFor("/api/v1/products")).toBe("/api/v1/products");
    expect(mountedPrefixFor("/api/v1/products/abc")).toBe("/api/v1/products");
    expect(mountedPrefixFor("/api/v1/farms/e2e-1/events")).toBe("/api/v1/farms");
    expect(mountedPrefixFor("/health")).toBe("/health");
    expect(mountedPrefixFor("/ready")).toBe("/ready");
    expect(mountedPrefixFor("/metrics")).toBe("/metrics");
    // A scanner path belongs to no mount — it must not mint a label.
    expect(mountedPrefixFor("/wp-admin.php")).toBeNull();
  });

  it("an auth refusal on a real endpoint is attributed to its mount", async () => {
    const res = await request(app).get("/api/v1/products");
    expect(res.status).toBe(401);
    const metrics = await (await request(app).get("/metrics")).text;
    expect(metrics).toMatch(/agrobridge_http_requests_total\{[^}]*route="\/api\/v1\/products"[^}]*status="401"/);
  });

  it("a real endpoint's own 404 is attributed to its mount, not unmatched", async () => {
    // The request is under a known mount even though no route layer dispatched
    // (the id matches nothing) — the exact shape of a pre-handler refusal.
    const res = await request(app).get("/api/v1/analytics/nope");
    expect(res.status).toBe(404);
    const metrics = await (await request(app).get("/metrics")).text;
    expect(metrics).toMatch(/agrobridge_http_requests_total\{[^}]*route="\/api\/v1\/analytics"[^}]*status="404"/);
  });

  it("a truly unmatched path stays 'unmatched' (the label cannot grow per URL)", async () => {
    await request(app).get("/definitely-not-a-route");
    const metrics = await (await request(app).get("/metrics")).text;
    expect(metrics).toMatch(/agrobridge_http_requests_total\{[^}]*route="unmatched"[^}]*status="404"/);
  });

  it("a matched route keeps its full pattern label", async () => {
    await request(app).get("/health");
    const metrics = await (await request(app).get("/metrics")).text;
    expect(metrics).toMatch(/agrobridge_http_requests_total\{[^}]*route="\/health"[^}]*status="200"/);
  });
});

describe("admission shedding is a signal, not only a log line (F-71)", () => {
  it("the counter is registered with a name and help an operator can alert on", async () => {
    const metrics = await (await request(app).get("/metrics")).text;
    expect(metrics).toContain("# HELP agobridge_requests_shed_total Requests refused by admission control");
    expect(metrics).toContain("# TYPE agobridge_requests_shed_total counter");
    expect(requestsShedTotal).toBeDefined();
  });

  it("it is part of the exported registry (a scrape really carries it)", async () => {
    const names = (await registry.getMetricsAsJSON()).map((m) => m.name);
    expect(names).toContain("agobridge_requests_shed_total");
  });

  it("the admission guard increments it when it sheds", async () => {
    // The end-to-end path is exercised by admission-and-pool.test.ts; the wiring
    // (guard imports and increments THIS counter) is pinned at the source level
    // so a refactor cannot silently drop the metric again.
    const src = readFileSync(new URL("../src/middleware/admission.ts", import.meta.url), "utf8");
    expect(src).toContain('import { requestsShedTotal } from "../infrastructure/metrics.js"');
    expect(src).toMatch(/shed\+\+;[\s\S]*?requestsShedTotal\.inc\(\)/);
  });
});

describe("provider health is observable, not write-only (F-28)", () => {
  it("the registry is seeded with every configured provider at startup", () => {
    const health = getHealthRegistry();
    // Importing the app (helpers.ts) ran createApp → initHealthRegistry.
    for (const provider of ["ai", "weather", "sms", "storage", "payment"]) {
      expect(health[provider], `${provider} was never seeded into the health registry`).toBeTruthy();
      expect(health[provider]!.status).toMatch(/^(HEALTHY|DEGRADED|DOWN|DISABLED)$/);
    }
  });

  it("a degraded/down provider surfaces on the metrics scrape with a numeric level", async () => {
    // The AI gateway's failure path calls markDown("ai", …); simulate exactly
    // that and assert the registry value reaches Prometheus.
    markDegraded("ai", "test-induced degradation");
    const degraded = await (await request(app).get("/metrics")).text;
    expect(degraded).toMatch(/agobridge_provider_health\{provider="ai",status="DEGRADED"\} 0\.5/);

    markDown("ai", "test-induced outage");
    const down = await (await request(app).get("/metrics")).text;
    expect(down).toMatch(/agobridge_provider_health\{provider="ai",status="DOWN"\} 0/);
  });
});

describe("correlation survives a body-parser rejection (F-73)", () => {
  it("malformed JSON answers with a requestId in the envelope AND an X-Request-Id header", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"phone": "01700000000", '); // truncated

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
    // The regression: express.json() ran before requestContext, so this was
    // `requestId: undefined` and no header at all.
    expect(res.body.requestId).toBeTruthy();
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });

  it("an oversized body is refused with a correlation id too (413, same parser path)", async () => {
    const huge = `{"pad":"${"x".repeat(1_100_000)}"}`; // over the 1mb json limit
    const res = await request(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send(huge);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(res.body.requestId).toBeTruthy();
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });

  it("the caller's own request id is preserved through the parser rejection", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", "caller-supplied-correlation-1")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.headers["x-request-id"]).toBe("caller-supplied-correlation-1");
    expect(res.body.requestId).toBe("caller-supplied-correlation-1");
  });
});
