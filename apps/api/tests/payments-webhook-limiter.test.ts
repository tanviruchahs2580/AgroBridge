// PAY-03: the SSLCommerz webhook is exempt from the global per-address
// limiter and carries its own generous flood cap instead. This file needs a
// TINY global budget to prove the exemption behaviourally, so the documented
// variable is pinned here BEFORE the app modules parse env — the same pattern
// tests/setup-env.ts uses for LOGIN_RATE_LIMIT_MAX.
process.env.RATE_LIMIT_MAX = "2";

import { describe, expect, it } from "vitest";
import request from "supertest";

const { app } = await import("./helpers.js");

function badSignaturePost() {
  return request(app)
    .post("/api/v1/payments/webhook/sslcommerz")
    .type("form")
    .send({ tran_id: "SBX-lim-test", status: "VALID", verify_sign: "deadbeef" });
}

describe("PAY-03 — webhook sits outside the global limiter", () => {
  it("keeps answering (401 invalid signature, never 429) well past the global budget", async () => {
    // The global budget is 2 for this file. Five webhook posts with a bad
    // signature must all be evaluated by the SIGNATURE gate (401), not shed
    // by the global limiter (429) — real IPNs come from a handful of gateway
    // addresses and must never 429.
    for (let i = 0; i < 5; i++) {
      const res = await badSignaturePost();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");
    }
  });

  it("while non-webhook traffic from the same address IS globally limited at that budget", async () => {
    // The webhook posts above did NOT consume the global budget (that is the
    // exemption). Three direct non-webhook requests against a budget of 2
    // prove the global limiter is active and address-keyed in this window —
    // so the webhook's five 401s above passed because of the exemption, not
    // because the limiter was off.
    let last = 0;
    let lastCode = "";
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/api/v1/auth/me");
      last = res.status;
      lastCode = res.body?.error?.code ?? "";
    }
    expect(last).toBe(429);
    expect(lastCode).toBe("RATE_LIMITED");
  });
});
