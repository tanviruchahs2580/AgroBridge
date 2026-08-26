import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("Auth hardening — refresh rotation with reuse detection", () => {
  it("replaying a revoked refresh token revokes the ENTIRE family (second still-valid token also dies)", async () => {
    const f = await registerFarmer({ password: "Family@1234" });

    // Two independent sessions => two live refresh tokens in the same family.
    const loginA = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Family@1234" });
    const loginB = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Family@1234" });
    expect(loginA.status).toBe(200);
    expect(loginB.status).toBe(200);
    const tokenA = loginA.body.data.refreshToken as string;
    const tokenB = loginB.body.data.refreshToken as string;
    expect(tokenB).not.toBe(tokenA);

    // Normal rotation on session A succeeds and revokes tokenA.
    const rotated = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: tokenA });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(tokenA);

    // Theft signal: tokenA is replayed after rotation.
    const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: tokenA });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("UNAUTHORIZED");

    // The still-valid token from session B must now be dead as well —
    // reuse detection nukes every unrevoked token for the user.
    const collateral = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: tokenB });
    expect(collateral.status).toBe(401);

    const remaining = await prisma.refreshToken.count({ where: { userId: f.user.id, revokedAt: null } });
    expect(remaining).toBe(0);
  });

  it("a freshly issued token keeps working when NO reuse happened (rotation only)", async () => {
    const f = await registerFarmer();
    const r1 = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: f.refreshToken });
    expect(r1.status).toBe(200);
    const r2 = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: r1.body.data.refreshToken });
    expect(r2.status).toBe(200); // legitimate chained rotation is unaffected
  });
});

describe("Auth hardening — phone OTP verification", () => {
  it("request returns devCode outside production; wrong code rejected then correct code verifies", async () => {
    const f = await registerFarmer();
    // Registration auto-verifies outside production; reset to exercise the flow.
    await prisma.user.update({ where: { id: f.user.id }, data: { phoneVerified: false } });

    const reqRes = await request(app).post("/api/v1/auth/otp/request").set("Authorization", `Bearer ${f.accessToken}`);
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.data.sent).toBe(true);
    const devCode = reqRes.body.data.devCode as string | undefined;
    expect(devCode).toMatch(/^\d{6}$/); // echoed back for testability outside production

    // Codes are 6-digit ints >= 100000, so 000000 can never match.
    const wrong = await request(app)
      .post("/api/v1/auth/otp/verify")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ code: "000000" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.message).toMatch(/incorrect/i);

    // Attempts increment but the same challenge stays usable for the right code.
    const right = await request(app)
      .post("/api/v1/auth/otp/verify")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ code: devCode });
    expect(right.status).toBe(200);
    expect(right.body.data.phoneVerified).toBe(true);

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(me.body.data.phoneVerified).toBe(true);

    // Challenge consumed: reusing the code fails.
    const reuse = await request(app)
      .post("/api/v1/auth/otp/verify")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ code: devCode });
    expect(reuse.status).toBe(422);
  });

  it("requesting a new OTP invalidates the previous unconsumed challenge", async () => {
    const f = await registerFarmer();
    const first = await request(app).post("/api/v1/auth/otp/request").set("Authorization", `Bearer ${f.accessToken}`);
    const second = await request(app).post("/api/v1/auth/otp/request").set("Authorization", `Bearer ${f.accessToken}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const staleVerify = await request(app)
      .post("/api/v1/auth/otp/verify")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ code: first.body.data.devCode });
    expect(staleVerify.status).toBe(422);

    const freshVerify = await request(app)
      .post("/api/v1/auth/otp/verify")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ code: second.body.data.devCode });
    expect(freshVerify.status).toBe(200);
  });
});

describe("Auth hardening — account deletion (anonymize + disable)", () => {
  it("blocks deletion while a withdrawal is pending, then anonymizes, disables and blocks login", async () => {
    const f = await registerFarmer({ password: "DeleteMe@1" });

    // In-flight payout withdrawal must be resolved first.
    await prisma.withdrawal.create({
      data: { refNo: `WDL-DEL-${Date.now()}`, userId: f.user.id, amountPaisa: 25_000, channel: "BKASH" },
    });
    const blocked = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.message).toMatch(/withdrawal/i);

    await prisma.withdrawal.updateMany({ where: { userId: f.user.id }, data: { status: "REJECTED" } });

    const del = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(stored.status).toBe("DISABLED");
    expect(stored.fullName).toBe("Deleted User");
    expect(stored.phone).toBe(`DEL-${f.user.id}`);
    expect(stored.email).toBeNull();

    // Old credentials no longer grant access.
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "DeleteMe@1" });
    expect(login.status).toBe(401);
  });

  it("deletion revokes all refresh tokens immediately", async () => {
    const f = await registerFarmer();
    const del = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(del.status).toBe(200);
    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: f.refreshToken });
    expect(refresh.status).toBe(401);
    const liveTokens = await prisma.refreshToken.count({ where: { userId: f.user.id, revokedAt: null } });
    expect(liveTokens).toBe(0);
  });
});
