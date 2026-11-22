import { describe, expect, it } from "vitest";
import request from "supertest";

// This suite issues 300+ unauthenticated requests (register/login/refresh carry
// no bearer token), which would spend the shared per-address global budget
// (default 300/15min) before the assertions ran. Raise the same documented
// variable CI raises for its browser e2e job — the limiter under test here is
// the REFRESH limiter, not the global one.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? "2000";

const { app, registerFarmer } = await import("./helpers.js");

/**
 * SEC-01 / FIX-01: the refresh limiter is keyed on the PRESENTED TOKEN, not on
 * the address. /refresh used to share loginLimiter, whose key fell back to
 * `ip:` for a phone-less body — a few dozen users behind one carrier-NAT
 * address could log each other out mid-session. Acceptance: many users on one
 * address each refresh several times with zero 429s; a single token hammered
 * past its own budget meets the limiter with the standard envelope.
 */
describe("SEC-01 refresh limiter — per-token budget, NAT-safe", () => {
  it("50 users on one address each refresh four times with zero 429s", async () => {
    const refreshTokens: string[] = [];
    for (let i = 0; i < 50; i++) {
      const f = await registerFarmer();
      const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
      expect(login.status).toBe(200);
      refreshTokens.push(login.body.data.refreshToken as string);
    }
    for (const rt of refreshTokens) {
      let current = rt;
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: current });
        expect(res.status).toBe(200);
        current = res.body.data.refreshToken as string;
      }
    }
  }, 180_000);

  it("one token hammered past its budget hits 429 with the standard envelope", async () => {
    const f = await registerFarmer();
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(login.status).toBe(200);
    const rt = login.body.data.refreshToken as string;
    let last = 0;
    let lastBody: Record<string, unknown> = {};
    for (let i = 0; i < 65; i++) {
      const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: rt });
      last = res.status;
      lastBody = res.body as Record<string, unknown>;
      if (res.status === 429) break;
    }
    // The first request rotates the token (200); replays of the original are
    // counted by the limiter even though auth rejects them — so the budget
    // exhausts on the presented-token key, not on any auth outcome.
    expect(last).toBe(429);
    const err = (lastBody as { error?: { code?: string } }).error;
    expect(err?.code).toBe("RATE_LIMITED");
    expect((lastBody as { requestId?: string }).requestId).toBeTruthy();
  }, 60_000);

  it("the default budget is the documented 60 per window (standard headers pin it)", async () => {
    const f = await registerFarmer();
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(login.status).toBe(200);
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login.body.data.refreshToken });
    expect(res.status).toBe(200);
    // standardHeaders: true emits RateLimit-Limit; with REFRESH_RATE_LIMIT_MAX
    // unset this pins the documented default of 60 (a hammer test alone would
    // pass for any default ≥ the hammer length).
    expect(res.headers["ratelimit-limit"]).toBe("60");
  });
});
