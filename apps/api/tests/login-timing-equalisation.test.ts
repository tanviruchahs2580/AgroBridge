import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { verifyPasswordAgainst } from "../src/modules/auth/password.js";
import { bcryptPoolStats } from "../src/modules/auth/bcryptPool.js";

/**
 * B-05: an unknown phone must cost the same bcrypt work as a wrong password.
 * Asserted structurally (the comparison executes, against a real dummy hash, at
 * the configured cost) — never by wall-clock timing, which is flaky on shared
 * runners.
 *
 * The comparison moved into the bcrypt worker pool (F-02), so it can no longer be
 * observed by spying on `bcrypt.compare` from this thread. The property is
 * asserted at the boundary where it now happens instead: the worker reports
 * whether it compared against the dummy hash, and the pool reports the cost factor
 * both paths share. A short-circuit on the unknown-phone path — the exact
 * regression this spec exists to catch — still fails these assertions.
 */
describe("login timing equalisation (B-05)", () => {
  it("verifyPasswordAgainst(null, …) still performs one bcrypt comparison against the dummy hash", async () => {
    const before = bcryptPoolStats();

    const result = await verifyPasswordAgainst(null, "any-password");
    expect(result).toBe(false);

    const after = bcryptPoolStats();
    // Exactly one comparison was performed…
    expect(after.pooled - before.pooled).toBe(1);
    // …in the worker, against the dummy hash rather than short-circuiting…
    expect(after.dummyComparisons - before.dummyComparisons).toBe(1);
    expect(after.fallback - before.fallback).toBe(0);
    // …at the same cost factor real hashes use, which is the equality that makes
    // the two paths indistinguishable.
    expect(after.cost).toBe(before.cost);
    expect(after.cost).toBe(4); // the test profile hashes at 4; production boots at 12
  });

  it("verifyPasswordAgainst(hash, …) returns the real comparison result and does not use the dummy", async () => {
    const before = bcryptPoolStats();
    const hash = await bcrypt.hash("correct-horse", 4);
    await expect(verifyPasswordAgainst(hash, "correct-horse")).resolves.toBe(true);
    await expect(verifyPasswordAgainst(hash, "wrong-horse")).resolves.toBe(false);
    // A real hash must never be routed through the dummy path.
    expect(bcryptPoolStats().dummyComparisons - before.dummyComparisons).toBe(0);
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
