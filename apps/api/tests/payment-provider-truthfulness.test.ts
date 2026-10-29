import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./helpers.js";
import { paymentSandboxProblem } from "../src/config/env.js";
import { sslcommerzMode } from "../src/providers/payment/sslcommerz.js";

/**
 * AUD-103 (S1): the SSLCommerz adapter reports the host it actually talks to.
 *
 * It used to declare `mode = "live"` unconditionally while routing every
 * non-"false" SSLCOMMERZ_SANDBOX value to sandbox.sslcommerz.com — so a
 * production deployment with sandbox credentials would confirm orders as PAID
 * with no money collected, while the API reported a live provider and the UI
 * showed no sandbox notice. Two independent guards now hold that line: the
 * adapter's reported mode follows the host, and production refuses to boot
 * without the explicit flag.
 */
describe("AUD-103: SSLCommerz reports the host it really uses", () => {
  it("only the literal \"false\" selects the live host", () => {
    expect(sslcommerzMode("false")).toBe("live");
    expect(sslcommerzMode(undefined)).toBe("sandbox");
    expect(sslcommerzMode("")).toBe("sandbox");
    expect(sslcommerzMode("0")).toBe("sandbox");
    expect(sslcommerzMode("FALSE")).toBe("sandbox");
  });

  it("production refuses any value that would route real buyers to the sandbox", () => {
    expect(paymentSandboxProblem({ SSLCOMMERZ_SANDBOX: "false" })).toBeNull();
    for (const value of [undefined, "", "true", "FALSE", "0"]) {
      expect(paymentSandboxProblem({ SSLCOMMERZ_SANDBOX: value })).toMatch(/SSLCOMMERZ_SANDBOX/);
    }
  });

  it("/ready reports which gateway is active and whether it is the sandbox", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    // The test profile runs the sandbox provider; the field must exist and be
    // truthful, not merely present.
    expect(res.body.payments).toEqual({ provider: "sandbox", sandbox: true });
  });
});
