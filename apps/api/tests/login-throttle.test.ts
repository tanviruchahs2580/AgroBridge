import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, uniquePhone } from "./helpers.js";
import { LOGIN_THROTTLE } from "../src/modules/auth/accountThrottle.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Per-account login throttling (AUD-142a).
 *
 * The per-IP limiter (loginLimiter) bounds one source; these tests pin the
 * account-keyed layer that bounds many sources against one number. The key is
 * hashed, and unknown numbers are throttled the same way, so the lock state is
 * not an existence oracle.
 */
describe("per-account login throttle", () => {
  it("locks the account after MAX_FAILURES bad passwords and returns 429 ACCOUNT_LOCKED", async () => {
    const f = await registerFarmer();
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES; i++) {
      const res = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Wrong@0000" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    }
    const locked = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Wrong@0000" });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("ACCOUNT_LOCKED");

    // Even the correct password is refused while the lock stands.
    const withRight = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(withRight.status).toBe(429);
    expect(withRight.body.error.code).toBe("ACCOUNT_LOCKED");
  });

  it("a successful login before the threshold clears the counter", async () => {
    const f = await registerFarmer();
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES - 2; i++) {
      await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Wrong@0000" });
    }
    const okLogin = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(okLogin.status).toBe(200);

    // Counter reset: the full budget is available again.
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES - 1; i++) {
      const res = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Wrong@0000" });
      expect(res.status).toBe(401);
    }
    const last = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Wrong@0000" });
    expect(last.status).toBe(401);
  });

  it("expired locks reset the counter instead of re-locking instantly", async () => {
    const f = await registerFarmer();
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES; i++) {
      await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Wrong@0000" });
    }
    // Simulate the lock window passing (no fake timers: move the stored instant).
    await prisma.loginAttempt.updateMany({ data: { lockedUntil: new Date(Date.now() - 60_000) } });
    const afterWindow = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(afterWindow.status).toBe(200);
  });

  it("unknown numbers are throttled identically (no existence oracle)", async () => {
    const ghost = uniquePhone();
    for (let i = 0; i < LOGIN_THROTTLE.MAX_FAILURES; i++) {
      const res = await request(app).post("/api/v1/auth/login").send({ phone: ghost, password: "Wrong@0000" });
      expect(res.status).toBe(401);
    }
    const locked = await request(app).post("/api/v1/auth/login").send({ phone: ghost, password: "Wrong@0000" });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("ACCOUNT_LOCKED");
  });
});
