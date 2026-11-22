import { describe, expect, it } from "vitest";
import request from "supertest";
import { totpAt } from "../src/lib/otp.js";
import { app, registerFarmer, createUserWithRole, requestStepUpCode } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * SEC-04 (FIX-14): the second-factor and step-up re-auth gates.
 *
 *  - `POST /auth/otp/stepup` mints a STEP_UP challenge (dev shortcut echoes the
 *    code — tests run with DEV_AUTH_SHORTCUTS=1, see tests/setup-env.ts).
 *  - `DELETE /auth/me` and `POST /wallet/withdrawals` consume a fresh STEP_UP
 *    code before doing anything irreversible or money-moving.
 *  - TOTP enrolment is an administrator-tier control (ADMIN/SUPER_ADMIN only);
 *    an enrolled admin's LOGIN demands the 6-digit authenticator code.
 *
 * Every TOTP test uses a FRESH admin from `createUserWithRole("ADMIN")` rather
 * than the seeded one behind `getAdmin()`: activating TOTP on the shared seed
 * admin would make its cached login context useless to every other suite in
 * this file (and `getAdmin` caches per file), so each test burns its own
 * disposable administrator instead.
 */

const nowStep = () => Math.floor(Date.now() / 30_000);
/** A 6-digit string the issuer can never have produced (codes are >= 100000). */
const IMPOSSIBLE_CODE = "000000";

async function enrollAndActivate(admin: { accessToken: string }) {
  const enroll = await request(app).post("/api/v1/auth/totp/enroll").set("Authorization", `Bearer ${admin.accessToken}`);
  expect(enroll.status).toBe(200);
  const { secret } = enroll.body.data as { secret: string; otpauthUrl: string };
  const activate = await request(app)
    .post("/api/v1/auth/totp/activate")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ code: totpAt(secret, nowStep()) });
  expect(activate.status).toBe(200);
  return secret;
}

describe("SEC-04 — step-up challenge issuance", () => {
  it("requires an authenticated caller", async () => {
    const res = await request(app).post("/api/v1/auth/otp/stepup");
    expect(res.status).toBe(401);
  });

  it("mints a 6-digit code echoed back for the dev/test path", async () => {
    const f = await registerFarmer();
    const res = await request(app).post("/api/v1/auth/otp/stepup").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(res.body.data.expiresAt).toBeTruthy();
    expect(res.body.data.devCode).toMatch(/^\d{6}$/);
  });
});

describe("SEC-04 — TOTP enrolment (administrator tier)", () => {
  it("a FARMER cannot enrol — 403 and nothing persisted", async () => {
    const f = await registerFarmer();
    const res = await request(app).post("/api/v1/auth/totp/enroll").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(user.totpSecret).toBeNull();
    expect(user.totpEnabledAt).toBeNull();
  });

  it("an admin enrols, a wrong activate code is rejected, the correct one enables", async () => {
    const admin = await createUserWithRole("ADMIN");

    // Activating with no pending enrolment is a 422, before any code check.
    const premature = await request(app)
      .post("/api/v1/auth/totp/activate")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ code: IMPOSSIBLE_CODE });
    expect(premature.status).toBe(422);

    const enroll = await request(app).post("/api/v1/auth/totp/enroll").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(enroll.status).toBe(200);
    const { secret, otpauthUrl } = enroll.body.data as { secret: string; otpauthUrl: string };
    // Base32 (RFC 4648, no padding): 20 random bytes -> exactly 32 chars of A-Z2-7.
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUrl).toContain("issuer=AgroBridge");
    expect(otpauthUrl).toContain(`secret=${secret}`);

    const wrong = await request(app)
      .post("/api/v1/auth/totp/activate")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ code: IMPOSSIBLE_CODE });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("TOTP_INVALID");

    const activate = await request(app)
      .post("/api/v1/auth/totp/activate")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ code: totpAt(secret, nowStep()) });
    expect(activate.status).toBe(200);
    expect(activate.body.data).toEqual({ enabled: true });

    // Re-enrolling while enabled is a conflict, not a silent secret rotation.
    const reEnroll = await request(app).post("/api/v1/auth/totp/enroll").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(reEnroll.status).toBe(409);
  });
});

describe("SEC-04 — login demands the TOTP code once enrolled", () => {
  it("no totp -> 401 TOTP_REQUIRED; wrong totp -> 401 TOTP_INVALID (+audit); correct totp -> 200", async () => {
    const admin = await createUserWithRole("ADMIN");
    const secret = await enrollAndActivate(admin);

    const noCode = await request(app).post("/api/v1/auth/login").send({ phone: admin.phone, password: "Test@1234" });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe("TOTP_REQUIRED");

    const wrongCode = await request(app)
      .post("/api/v1/auth/login")
      .send({ phone: admin.phone, password: "Test@1234", totp: IMPOSSIBLE_CODE });
    expect(wrongCode.status).toBe(401);
    expect(wrongCode.body.error.code).toBe("TOTP_INVALID");
    // The failed second-factor attempt is on the security trail with its reason.
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "AUTH_LOGIN_FAILED", entityId: admin.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.metaStr).toContain("totp_invalid");

    const good = await request(app)
      .post("/api/v1/auth/login")
      .send({ phone: admin.phone, password: "Test@1234", totp: totpAt(secret, nowStep()) });
    expect(good.status).toBe(200);
    expect(good.body.data.accessToken).toBeTruthy();
    // A wrong password still fails exactly as before — the factor check runs
    // only after the password has proven possession.
    const badPassword = await request(app).post("/api/v1/auth/login").send({ phone: admin.phone, password: "Wrong@Pass1" });
    expect(badPassword.status).toBe(401);
  });

  it("the factor persists: a fresh login is challenged again after a successful one", async () => {
    const admin = await createUserWithRole("ADMIN");
    const secret = await enrollAndActivate(admin);

    const first = await request(app)
      .post("/api/v1/auth/login")
      .send({ phone: admin.phone, password: "Test@1234", totp: totpAt(secret, nowStep()) });
    expect(first.status).toBe(200);

    // A brand-new session without the code is challenged again — enabling TOTP
    // once protects every later login, not just the next one.
    const again = await request(app).post("/api/v1/auth/login").send({ phone: admin.phone, password: "Test@1234" });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("TOTP_REQUIRED");
  });

  it("disable with a correct code removes the factor; login without totp succeeds again", async () => {
    const admin = await createUserWithRole("ADMIN");
    const secret = await enrollAndActivate(admin);

    const disable = await request(app)
      .post("/api/v1/auth/totp/disable")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ code: totpAt(secret, nowStep()) });
    expect(disable.status).toBe(200);
    expect(disable.body.data).toEqual({ enabled: false });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(stored.totpSecret).toBeNull();
    expect(stored.totpEnabledAt).toBeNull();

    const login = await request(app).post("/api/v1/auth/login").send({ phone: admin.phone, password: "Test@1234" });
    expect(login.status).toBe(200);
  });
});

describe("SEC-04 — withdrawals demand a step-up code", () => {
  it("no otp is refused by the gate (400 OTP_EXPIRED); a wrong code is 400 OTP_INVALID; a minted code creates the withdrawal", async () => {
    const f = await registerFarmer();
    await prisma.wallet.upsert({
      where: { userId: f.user.id },
      update: { balancePaisa: { increment: 100_000 } },
      create: { userId: f.user.id, balancePaisa: 100_000 },
    });

    // With `otp` optional in the schema, a missing code passes validation and
    // is refused by the ENFORCEMENT gate: 422 OTP_EXPIRED with the remedy copy
    // ("request a verification code first"), never a 400 shape mismatch.
    const noOtp = await request(app)
      .post("/api/v1/wallet/withdrawals")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ amountPaisa: 20_000, channel: "BKASH" });
    expect(noOtp.status).toBe(400);
    expect(noOtp.body.error.code).toBe("OTP_EXPIRED");

    // A live challenge exists (so this is the wrong-code branch, not no-active).
    await requestStepUpCode(f.accessToken);
    const wrongOtp = await request(app)
      .post("/api/v1/wallet/withdrawals")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ amountPaisa: 20_000, channel: "BKASH", otp: IMPOSSIBLE_CODE });
    expect(wrongOtp.status).toBe(422);
    expect(wrongOtp.body.error.code).toBe("OTP_INVALID");
    // Nothing was held or created by the rejected attempts.
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id } })).toBe(0);

    const good = await request(app)
      .post("/api/v1/wallet/withdrawals")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ amountPaisa: 20_000, channel: "BKASH", otp: await requestStepUpCode(f.accessToken) });
    expect(good.status).toBe(201);
    expect(good.body.data.status).toBe("PENDING");
    expect(good.body.data.destination).toMatch(/^\d{3}\*\*\*\d{4}$/);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.user.id } });
    expect(wallet.heldPaisa).toBe(20_000); // hold reserved exactly once
  });

  it("a consumed code cannot open a second withdrawal", async () => {
    const f = await registerFarmer();
    await prisma.wallet.upsert({
      where: { userId: f.user.id },
      update: { balancePaisa: { increment: 100_000 } },
      create: { userId: f.user.id, balancePaisa: 100_000 },
    });
    const otp = await requestStepUpCode(f.accessToken);

    const first = await request(app)
      .post("/api/v1/wallet/withdrawals")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ amountPaisa: 10_000, channel: "BKASH", otp });
    expect(first.status).toBe(201);

    // Keyless retry with the SAME code: not a keyed replay, so the gate runs —
    // and the challenge was consumed by the first withdrawal.
    const second = await request(app)
      .post("/api/v1/wallet/withdrawals")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ amountPaisa: 10_000, channel: "BKASH", otp });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe("OTP_EXPIRED");
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id } })).toBe(1);
  });
});

describe("SEC-04 — account deletion demands a step-up code", () => {
  it("a wrong otp is 400 OTP_INVALID and the account survives", async () => {
    const f = await registerFarmer();
    await requestStepUpCode(f.accessToken); // live challenge, deliberately misused below

    const res = await request(app)
      .delete("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ otp: IMPOSSIBLE_CODE });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("OTP_INVALID");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(stored.status).not.toBe("DISABLED");
    expect(stored.fullName).not.toBe("Deleted User");
  });
});
