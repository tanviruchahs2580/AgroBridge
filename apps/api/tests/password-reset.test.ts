import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, uniquePhone } from "./helpers.js";

/**
 * Password reset (AUD-143): the recovery path that did not exist at all.
 *
 * Covers: enumeration-safe start, SMS-code completion, session revocation on
 * success, OTP purpose separation (a phone-verify code cannot reset a
 * password), single use, and the wrong-code error codes the client maps.
 */
describe("password reset via SMS code", () => {
  it("resets the password, revokes sessions and lets the new password log in", async () => {
    const f = await registerFarmer();

    const forgot = await request(app).post("/api/v1/auth/password/forgot").send({ phone: f.phone });
    expect(forgot.status).toBe(200);
    expect(forgot.body.data.sent).toBe(true);
    const code = forgot.body.data.devCode as string; // non-production echo (tests only)
    expect(code).toMatch(/^\d{6}$/);

    const reset = await request(app)
      .post("/api/v1/auth/password/reset")
      .send({ phone: f.phone, otp: code, newPassword: "NewPass@2026" });
    expect(reset.status).toBe(200);
    expect(reset.body.data.reset).toBe(true);

    // Old password is dead, new one works.
    const oldLogin = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "NewPass@2026" });
    expect(newLogin.status).toBe(200);

    // Every session issued before the reset is revoked (a reset also answers
    // "my account is compromised").
    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: f.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("rejects a wrong code with OTP_INVALID and a reused/absent code with OTP_EXPIRED", async () => {
    const f = await registerFarmer();
    const forgot = await request(app).post("/api/v1/auth/password/forgot").send({ phone: f.phone });
    const code = forgot.body.data.devCode as string;

    const wrong = await request(app)
      .post("/api/v1/auth/password/reset")
      .send({ phone: f.phone, otp: "000000", newPassword: "Another@2026" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("OTP_INVALID");

    const good = await request(app)
      .post("/api/v1/auth/password/reset")
      .send({ phone: f.phone, otp: code, newPassword: "Another@2026" });
    expect(good.status).toBe(200);

    const reuse = await request(app)
      .post("/api/v1/auth/password/reset")
      .send({ phone: f.phone, otp: code, newPassword: "Third@2026" });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe("OTP_EXPIRED");
  });

  it("a phone-verification code cannot reset a password (purposes stay separate)", async () => {
    const f = await registerFarmer();
    const otpReq = await request(app)
      .post("/api/v1/auth/otp/request")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({});
    const verifyCode = otpReq.body.data.devCode as string;

    const reset = await request(app)
      .post("/api/v1/auth/password/reset")
      .send({ phone: f.phone, otp: verifyCode, newPassword: "Nope@20261" });
    expect(reset.status).toBe(400);
    expect(reset.body.error.code).toBe("OTP_EXPIRED");
  });

  it("unknown numbers get the same 200 as known ones (no existence oracle)", async () => {
    const res = await request(app).post("/api/v1/auth/password/forgot").send({ phone: uniquePhone() });
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.devCode).toBeUndefined();
  });

  it("limits reset-code requests per phone", async () => {
    const f = await registerFarmer();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/v1/auth/password/forgot").send({ phone: f.phone });
      expect(res.status).toBe(200);
    }
    const sixth = await request(app).post("/api/v1/auth/password/forgot").send({ phone: f.phone });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("RATE_LIMITED");
  });
});
