import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { normalizeBdPhone } from "../src/shared/utils/phone.js";

/**
 * B-06 / E-10: Bangladesh phone numbers must resolve to one canonical string
 * (`01[3-9]\d{8}`) regardless of the spelling the user typed — Bengali digits,
 * +880/880 prefixes, spaces, dashes — and anything ambiguous must be rejected
 * instead of silently rewritten.
 */
describe("normalizeBdPhone", () => {
  it("accepts the canonical local form", () => {
    expect(normalizeBdPhone("01712345678")).toBe("01712345678");
    expect(normalizeBdPhone("01987654321")).toBe("01987654321");
  });

  it("converts Bengali digits", () => {
    expect(normalizeBdPhone("০১৭১২৩৪৫৬৭৮")).toBe("01712345678");
  });

  it("accepts +880 and 880 prefixes, with or without the trunk zero", () => {
    expect(normalizeBdPhone("+8801712345678")).toBe("01712345678");
    expect(normalizeBdPhone("+880 1712-345678")).toBe("01712345678");
    expect(normalizeBdPhone("8801712345678")).toBe("01712345678");
    expect(normalizeBdPhone("+88001712345678")).toBe("01712345678");
  });

  it("tolerates spaces and dashes", () => {
    expect(normalizeBdPhone(" 017-1234 5678 ")).toBe("01712345678");
    expect(normalizeBdPhone("017 12 34 56 78")).toBe("01712345678");
  });

  it("returns null for anything ambiguous or non-BD — never rewrites it", () => {
    expect(normalizeBdPhone("+919876543210")).toBeNull(); // Indian number
    expect(normalizeBdPhone("00919876543210")).toBeNull();
    expect(normalizeBdPhone("1712345678")).toBeNull(); // bare 10-digit form
    expect(normalizeBdPhone("0131234567")).toBeNull(); // 10 digits local
    expect(normalizeBdPhone("02712345678")).toBeNull(); // invalid operator digit
    expect(normalizeBdPhone("017123456789")).toBeNull(); // 12 digits
    expect(normalizeBdPhone("01712abc678")).toBeNull(); // letters
    expect(normalizeBdPhone("")).toBeNull();
    expect(normalizeBdPhone("   ")).toBeNull();
    expect(normalizeBdPhone(1712345678)).toBeNull(); // not a string
  });
});

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Bengali-numeral rendering of an ASCII digit string. */
function toBengali(digits: string): string {
  return [...digits].map((d) => BENGALI_DIGITS[Number(d)]!).join("");
}
/** Unique canonical BD number per run (the suite may reuse its DB file). */
function uniqueLocal(operatorDigit = "8"): string {
  return `01${operatorDigit}${String(Date.now()).slice(-8)}`;
}

describe("phone normalisation is wired end-to-end (B-06)", () => {
  it("registers with Bengali digits and logs in with +880 / spaced spellings of the same number", async () => {
    const local = uniqueLocal("8");
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Nirmol Kumar", phone: toBengali(local), password: "Nirmol@1234", consent: true });
    expect(register.status).toBe(201);

    // Stored canonically, not as typed.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: register.body.data.user.id } });
    expect(stored.phone).toBe(local);

    // Every valid spelling of the same number hits the same account.
    const national = local.slice(1); // 1XXXXXXXXX without the trunk zero
    const spellings = [
      `+880 ${national.slice(0, 4)}-${national.slice(4)}`,
      `880${national}`,
      local,
      `${local.slice(0, 3)}-${local.slice(3, 7)} ${local.slice(7)}`,
    ];
    for (const spelling of spellings) {
      const login = await request(app).post("/api/v1/auth/login").send({ phone: spelling, password: "Nirmol@1234" });
      expect(login.status, `login failed for ${spelling}`).toBe(200);
      expect(login.body.data.user.id).toBe(register.body.data.user.id);
    }
  });

  it("treats a differently-formatted duplicate as the same account (neutral 200, nothing created)", async () => {
    const f = await registerFarmer();
    const again = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Duplicate Attempt", phone: `+880${f.phone.slice(1)}`, password: "Duplicate@123", consent: true });
    // Enumeration-safe duplicate handling: a differently-spelled duplicate of a
    // registered number resolves to the SAME account (normalisation) and gets
    // the neutral guidance response — not a 409 that would confirm existence.
    expect(again.status).toBe(200);
    expect(again.body.data.needsLogin).toBe(true);
    // The original credentials still work and remain the only account.
    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(login.status).toBe(200);
  });

  it("rejects non-normalisable phone numbers with 400", async () => {
    for (const bad of ["+919876543210", "1712345678", "12345", "02712345678", "০২৭১২৩৪৫৬৭৮", "01712abc678"]) {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({ fullName: "Bad Phone", phone: bad, password: "BadPhone@123", consent: true });
      expect(res.status, `expected 400 for ${bad}`).toBe(400);
    }
  });

  it("OTP request stores the canonical phone on the challenge (login/register lookups stay aligned)", async () => {
    const local = uniqueLocal("9");
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Otp Canon", phone: toBengali(local), password: "OtpCanon@123", consent: true });
    expect(register.status).toBe(201);

    const otp = await request(app)
      .post("/api/v1/auth/otp/request")
      .set("Authorization", `Bearer ${register.body.data.accessToken}`);
    expect(otp.status).toBe(200);

    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: register.body.data.user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(challenge.phone).toBe(local);
  });
});
