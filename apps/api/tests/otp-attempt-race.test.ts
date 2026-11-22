import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { deriveSubkey } from "../src/shared/utils/kdf.js";

/**
 * SEC-03 / FIX-06: the OTP attempt cap is enforced by ONE atomic conditional
 * UPDATE (so parallel wrong guesses cannot exceed 5), the forgot/reset limiter
 * budget is keyed on the NORMALIZED phone (so respelling one number cannot
 * mint fresh budgets), and the OTP pepper is a purpose-derived HKDF subkey —
 * no longer the raw JWT signing secret.
 */
describe("SEC-03 — OTP attempt cap, reset budget keying, pepper derivation", () => {
  it("parallel wrong guesses on /otp/verify never exceed the 5-attempt cap", async () => {
    const f = await registerFarmer();
    await prisma.user.update({ where: { id: f.user.id }, data: { phoneVerified: false } });
    const reqRes = await request(app).post("/api/v1/auth/otp/request").set("Authorization", `Bearer ${f.accessToken}`);
    expect(reqRes.status).toBe(200);

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(app).post("/api/v1/auth/otp/verify").set("Authorization", `Bearer ${f.accessToken}`).send({ code: "000000" })
      )
    );
    const incorrect = results.filter((r) => /Incorrect verification code/i.test(r.body?.error?.message ?? ""));
    const tooMany = results.filter((r) => /Too many attempts/i.test(r.body?.error?.message ?? ""));
    expect(incorrect.length).toBeLessThanOrEqual(5);
    expect(tooMany.length).toBe(12 - incorrect.length);
    expect(incorrect.length + tooMany.length).toBe(12);

    // The stored attempts value itself is capped: exactly 5, never more.
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: f.user.id, purpose: "PHONE_VERIFY", consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    expect(challenge?.attempts).toBe(5);

    // Even the CORRECT code is refused once the cap is spent — the cap is
    // enforced before the comparison, not after it.
    const devCode = reqRes.body.data.devCode as string | undefined;
    expect(devCode).toMatch(/^\d{6}$/);
    const correct = await request(app)
      .post("/api/v1/auth/otp/verify")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ code: devCode });
    expect(correct.status).toBe(422);
    expect(correct.body.error.message).toMatch(/Too many attempts/i);
  });

  it("a correct code still verifies within the cap (attempts count toward it, not against it)", async () => {
    const f = await registerFarmer();
    await prisma.user.update({ where: { id: f.user.id }, data: { phoneVerified: false } });
    const reqRes = await request(app).post("/api/v1/auth/otp/request").set("Authorization", `Bearer ${f.accessToken}`);
    const devCode = reqRes.body.data.devCode as string;

    // Four wrong guesses, then the correct one — the 5th attempt is the win.
    for (let i = 0; i < 4; i++) {
      const wrong = await request(app).post("/api/v1/auth/otp/verify").set("Authorization", `Bearer ${f.accessToken}`).send({ code: "000000" });
      expect(wrong.status).toBe(422);
    }
    const right = await request(app)
      .post("/api/v1/auth/otp/verify")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ code: devCode });
    expect(right.status).toBe(200);
    expect(right.body.data.phoneVerified).toBe(true);
  });

  it("every spelling of one phone shares ONE forgot budget (respelling cannot mint buckets)", async () => {
    const f = await registerFarmer();
    // forgotLimiter allows 5 per hour per (address, phone). Five DIFFERENT
    // spellings of the same number must consume that single budget.
    const spellings = [
      f.phone, // canonical 017…
      `+880${f.phone.slice(1)}`, // +880-prefixed
      `880${f.phone.slice(1)}`, // 880-prefixed
      [...f.phone].map((d) => "০১২৩৪৫৬৭৮৯"[Number(d)]).join(""), // Bengali digits
      f.phone, // canonical repeat — same bucket as the first
    ];
    for (const spelling of spellings) {
      const res = await request(app).post("/api/v1/auth/password/forgot").send({ phone: spelling });
      expect(res.status).toBe(200); // neutral 200 — budget consumed, not exhausted
    }
    const sixth = await request(app).post("/api/v1/auth/password/forgot").send({ phone: f.phone });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("RATE_LIMITED");
  });

  it("deriveSubkey: purpose-bound, deterministic, never the root secret", () => {
    const root = "some-root-secret-material";
    const a = deriveSubkey(root, "purpose-a");
    const b = deriveSubkey(root, "purpose-b");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveSubkey(root, "purpose-a")).toBe(a); // deterministic
    expect(a).not.toBe(b); // domain-separated
    expect(a).not.toContain(root); // never leaks the raw secret
    expect(deriveSubkey(root, "purpose-a", 16)).toMatch(/^[0-9a-f]{32}$/); // length parameter honoured
  });
});
