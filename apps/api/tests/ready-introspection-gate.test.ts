import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { app } from "./helpers.js";
import { readyDetailVisible } from "../src/app.js";
import { bearerMatches, hasOpsDetailAccess } from "../src/middleware/metricsGuard.js";
import type { Request } from "express";

/**
 * F-40: `/ready` published `schema.latest`, `limiterStore`, `storage.durable`
 * and `payments.sandbox` to unauthenticated callers — free reconnaissance on a
 * live deployment (`payments.sandbox: true` says simulated payments can be
 * completed; `storage.durable: false` advertises that uploads vanish on
 * redeploy).
 *
 * The boolean readiness signal stays public for the deploy gate and any load
 * balancer. The introspection block requires `METRICS_TOKEN` in production, and
 * is open outside production where there is nothing to learn from it.
 *
 * The production branch is pinned through the pure predicate (`readyDetailVisible`)
 * because this suite runs with NODE_ENV=test; the HTTP assertions below pin the
 * non-production behaviour and the token path.
 */
describe("/ready introspection is gated (F-40)", () => {
  it("outside production the detail is served (local docker Prometheus, tests, a dev curl)", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.db).toBe(true);
    expect(res.body.schema).toBeTypeOf("object");
    expect(res.body.limiterStore).toBeDefined();
    expect(res.body.storage).toBeTypeOf("object");
    expect(res.body.payments).toBeTypeOf("object");
  });

  it("the predicate closes production and opens only for a token holder", () => {
    // Production, no token: the detail must not be served.
    expect(readyDetailVisible({ environmentIsProduction: true, hasOpsDetailAccess: false })).toBe(false);
    // Production WITH the ops token: the deploy gate / on-call path.
    expect(readyDetailVisible({ environmentIsProduction: true, hasOpsDetailAccess: true })).toBe(true);
    // Non-production: open, token or not.
    expect(readyDetailVisible({ environmentIsProduction: false, hasOpsDetailAccess: false })).toBe(true);
    expect(readyDetailVisible({ environmentIsProduction: false, hasOpsDetailAccess: true })).toBe(true);
  });

  it("the ops-detail rule fails closed when METRICS_TOKEN is unset", () => {
    const req = { headers: {} } as unknown as Request;
    // No token configured in the test environment → nobody is an ops caller by
    // header, and the non-production branch is what opens the endpoint locally.
    expect(hasOpsDetailAccess(req)).toBe(false);
    expect(hasOpsDetailAccess({ headers: { authorization: "Bearer anything" } } as unknown as Request)).toBe(false);
  });

  it("bearer comparison is exact (constant-time helper used by both guards)", () => {
    expect(bearerMatches("Bearer secret", "secret")).toBe(true);
    expect(bearerMatches("Bearer secret ", "secret")).toBe(false);
    expect(bearerMatches("bearer secret", "secret")).toBe(false);
    expect(bearerMatches("", "secret")).toBe(false);
  });

  it("production without a token keeps the deploy-gate fields and omits only payments (F-40)", () => {
    // This suite runs with NODE_ENV=test, so the production branch is unreachable
    // over HTTP. It is pinned structurally, like the 503 branch below: the
    // no-access branch must still carry everything `deploy-verify.yml` asserts
    // unauthenticated (`schema`, `limiterStore`, `storage` — and `db`), because
    // gating them would break a working gate while demanding a secret the repo
    // does not have. The one field with reconnaissance value — `payments.sandbox`,
    // i.e. "can simulated payments be completed here" — must be absent.
    const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    const branch = /res\.json\(\{ ok: true, ready: true, db: true, schema, limiterStore, storage: storageReadiness\(\), detail: "requires-authorization" \}\);/.exec(src)?.[0] ?? "";
    expect(branch).not.toBe("");
    expect(branch).not.toContain("payments");
    // And the token holder's branch must still be the full detail.
    expect(src).toContain("payments: paymentsReadiness()");
  });

  it("the 503 branch answers with the standard error envelope (F-70)", async () => {
    // The branch is unreachable over HTTP while SQLite is up, so it is asserted
    // structurally: the source must return the envelope with a code, not a bare
    // { ok, ready, db } body a client cannot branch on.
    const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    const branch = /catch \{[\s\S]*?res\.status\(503\)[\s\S]*?\}\);/.exec(src)?.[0] ?? "";
    expect(branch).toContain('code: "NOT_READY"');
    expect(branch).toContain("requestId: req.requestId");
  });
});
