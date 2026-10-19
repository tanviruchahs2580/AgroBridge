import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { verifyPasswordAgainst } from "../src/modules/auth/password.js";

/**
 * B-05: an unknown phone must cost the same bcrypt work as a wrong password.
 * Asserted structurally (the comparison executes) — never by wall-clock timing,
 * which is flaky on shared runners.
 */
describe("login timing equalisation (B-05)", () => {
  it("verifyPasswordAgainst(null, …) still performs one bcrypt comparison against the dummy hash", async () => {
    const compareSpy = vi.spyOn(bcrypt, "compare");
    try {
      const result = await verifyPasswordAgainst(null, "any-password");
      expect(result).toBe(false);
      expect(compareSpy).toHaveBeenCalledTimes(1);
      const [passwordArg, hashArg] = compareSpy.mock.calls[0]!;
      expect(passwordArg).toBe("any-password");
      // A real bcrypt hash of the fixed dummy source — not a short-circuit.
      expect(hashArg).toMatch(/^\$2[aby]\$\d{2}\$/);
    } finally {
      compareSpy.mockRestore();
    }
  });

  it("verifyPasswordAgainst(hash, …) returns the real comparison result and does not use the dummy", async () => {
    const hash = await bcrypt.hash("correct-horse", 4);
    await expect(verifyPasswordAgainst(hash, "correct-horse")).resolves.toBe(true);
    await expect(verifyPasswordAgainst(hash, "wrong-horse")).resolves.toBe(false);
  });

  it("unknown phone and wrong password return byte-identical 401 error payloads", async () => {
    const f = await registerFarmer({ password: "RealPass@123" });

    const wrongPassword = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Nope@123" });
    const unknownPhone = await request(app).post("/api/v1/auth/login").send({ phone: "01799999999", password: "Nope@123" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownPhone.status).toBe(401);
    // Identical copy and code; only the support `reference` differs per request.
    expect(unknownPhone.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownPhone.body.error.message).toBe(wrongPassword.body.error.message);
    expect(unknownPhone.body.error.message).toBe("Invalid credentials");
    // The client renders INVALID_CREDENTIALS as "wrong number or password" and
    // UNAUTHORIZED as "session expired"; login failures must carry the former
    // (the latter told users their session had expired — live-found 2026-10-19).
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknownPhone.body.error.details).toBeUndefined();
    expect(wrongPassword.body.error.details).toBeUndefined();
  });
});
