import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./helpers.js";
import { paymentSandboxProblem, liveGatewayPublicUrlProblem } from "../src/config/env.js";
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

/**
 * SEC-05: the live gateway must not build callback/IPN URLs from the request's
 * Host header. Boot refuses unless API_PUBLIC_URL is an https URL when
 * SSLCOMMERZ_SANDBOX is literally "false"; sandbox mode (no real money) is
 * unaffected.
 */
describe("SEC-05: live gateway requires an https API_PUBLIC_URL", () => {
  it("sandbox mode never demands the variable", () => {
    for (const sandbox of [undefined, "true"]) {
      expect(liveGatewayPublicUrlProblem({ SSLCOMMERZ_SANDBOX: sandbox, API_PUBLIC_URL: undefined })).toBeNull();
      expect(liveGatewayPublicUrlProblem({ SSLCOMMERZ_SANDBOX: sandbox, API_PUBLIC_URL: "http://insecure" })).toBeNull();
    }
  });

  it("live mode refuses to boot without the variable, or with a non-https one", () => {
    expect(liveGatewayPublicUrlProblem({ SSLCOMMERZ_SANDBOX: "false", API_PUBLIC_URL: undefined })).toMatch(/API_PUBLIC_URL/);
    expect(liveGatewayPublicUrlProblem({ SSLCOMMERZ_SANDBOX: "false", API_PUBLIC_URL: "" })).toMatch(/API_PUBLIC_URL/);
    expect(liveGatewayPublicUrlProblem({ SSLCOMMERZ_SANDBOX: "false", API_PUBLIC_URL: "http://api.example.com" })).toMatch(/https/);
    expect(liveGatewayPublicUrlProblem({ SSLCOMMERZ_SANDBOX: "false", API_PUBLIC_URL: "https://api.example.com" })).toBeNull();
  });
});
