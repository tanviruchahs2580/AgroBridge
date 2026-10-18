import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * H-07 residual: express-rate-limit's built-in serializer answers with a bare
 * object and no request id. Every limiter in marketplace/ and payments/ now
 * installs the shared rateLimitHandler, so a throttled caller receives the
 * standard envelope — ok:false, error.code RATE_LIMITED, requestId — while the
 * limiter's own message text is preserved.
 *
 * The financial limiter (payments/routes.ts) allows 20/hour per user; a fresh
 * user therefore makes the 21st request the throttled one. Each attempt before
 * that is a normal 404 (no such membership plan) — it still counts toward the
 * window, which is what lets this test exhaust the limiter cheaply.
 */
describe("Rate-limit response envelope (H-07)", () => {
  it("throttled financial request returns the standard envelope with ok:false, RATE_LIMITED and a requestId", async () => {
    const f = await registerFarmer();

    let throttled: request.Response | null = null;
    for (let i = 0; i < 25 && !throttled; i++) {
      const r = await request(app)
        .post("/api/v1/payments/intent")
        .set("Authorization", `Bearer ${f.accessToken}`)
        .send({ purposeType: "MEMBERSHIP", purposeId: `no-such-plan-${i}` });
      if (r.status === 429) throttled = r;
      else expect(r.status).toBe(404);
    }

    expect(throttled).not.toBeNull();
    expect(throttled!.body.ok).toBe(false);
    expect(throttled!.body.error.code).toBe("RATE_LIMITED");
    // The limiter's own message option survives the standard envelope.
    expect(throttled!.body.error.message).toMatch(/financial operations/i);
    expect(typeof throttled!.body.requestId).toBe("string");
    expect((throttled!.body.requestId as string).length).toBeGreaterThan(0);
    expect(throttled!.headers["x-request-id"]).toBe(throttled!.body.requestId);
  });
});
