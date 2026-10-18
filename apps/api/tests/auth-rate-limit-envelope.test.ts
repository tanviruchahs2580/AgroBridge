import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * Every auth limiter routes its 429 through `rateLimitHandler`, so a throttled
 * caller gets the standard envelope WITH `requestId` (correlatable to logs) and
 * the limiter's own copy — not express-rate-limit's bare serializer output.
 * Uses the OTP-verify limiter (20/hour, per user, not skipped in tests).
 */
describe("auth rate limiter 429 envelope", () => {
  it("an exhausted auth limiter returns RATE_LIMITED + requestId in the standard envelope", async () => {
    const f = await registerFarmer();

    let limited: request.Response | null = null;
    for (let i = 0; i < 25 && !limited; i++) {
      const res = await request(app)
        .post("/api/v1/auth/otp/verify")
        .set("Authorization", `Bearer ${f.accessToken}`)
        .send({ code: "000000" });
      if (res.status === 429) limited = res;
      else expect(res.status).toBe(422); // no active challenge
    }

    expect(limited, "OTP verify limiter never fired within 25 attempts").not.toBeNull();
    expect(limited!.body.ok).toBe(false);
    expect(limited!.body.error.code).toBe("RATE_LIMITED");
    // The limiter's own message object is preserved (not overwritten by the handler).
    expect(limited!.body.error.message).toBe("Too many verification attempts. Please try again later.");
    expect(typeof limited!.body.requestId).toBe("string");
    expect(limited!.body.requestId.length).toBeGreaterThan(0);
    expect(limited!.headers["x-request-id"]).toBe(limited!.body.requestId);
  });
});
