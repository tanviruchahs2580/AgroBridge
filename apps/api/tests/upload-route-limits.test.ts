import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { registerFarmer } from "./helpers.js";
import { uploadImage, tinyPng } from "./upload-helper.js";
import { DISEASE_UPLOAD_LIMIT_PER_HOUR } from "../src/modules/disease/routes.js";

/**
 * SEC-11: the disease-photo endpoint carries a per-user upload limiter. The
 * limiter is NOT skipped in tests (same technique as
 * tests/auth-rate-limit-envelope.test.ts with the OTP limiter), so this drives
 * the real middleware: N accepted uploads, then the 429 envelope with
 * `code: RATE_LIMITED` and a `requestId`. A second user is unaffected —
 * the key is the authenticated user id, not the IP.
 */
describe("disease upload per-user rate limit (SEC-11)", () => {
  it("accepts up to the cap for one user, then returns the standard 429 envelope; another user is unaffected", async () => {
    const f = await registerFarmer();
    const stored: string[] = [];
    try {
      for (let i = 0; i < DISEASE_UPLOAD_LIMIT_PER_HOUR; i++) {
        const res = await uploadImage(f.accessToken, tinyPng(), "image/png", `limit-${i}.png`);
        expect(res.status, `upload ${i + 1} of ${DISEASE_UPLOAD_LIMIT_PER_HOUR}`).toBe(201);
        stored.push(res.body.data.imagePath as string);
      }

      const limited = await uploadImage(f.accessToken, tinyPng(), "image/png", "over-limit.png");
      expect(limited.status).toBe(429);
      expect(limited.body.ok).toBe(false);
      expect(limited.body.error.code).toBe("RATE_LIMITED");
      expect(limited.body.error.message).toBe("Too many photo uploads. Please try again later.");
      expect(typeof limited.body.requestId).toBe("string");
      expect(limited.body.requestId.length).toBeGreaterThan(0);
      expect(limited.headers["x-request-id"]).toBe(limited.body.requestId);

      // The limiter is per user: a fresh account still uploads normally.
      const other = await registerFarmer();
      const okOther = await uploadImage(other.accessToken, tinyPng(), "image/png", "other-user.png");
      expect(okOther.status).toBe(201);
      stored.push(okOther.body.data.imagePath as string);
    } finally {
      // Remove the files this test stored (the DB rows are harmless fixtures).
      for (const p of stored) rmSync(path.resolve(p), { force: true });
    }
  }, 30_000);
});
