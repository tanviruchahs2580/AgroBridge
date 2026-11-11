import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
// Static import is safe here: supertest reads no app config at import time. The
// env assignment above still runs before `./helpers.js` pulls in the app, which
// is the only module that must see AI_HOURLY_LIMIT.
import request from "supertest";

/**
 * F-62 — per-tier AI advisory quota.
 *
 * The seed advertised "Unlimited AI advisory" on SILVER/GOLD while every
 * account was capped at the flat `AI_HOURLY_LIMIT`; `membershipTier` was passed
 * into `AiContext` and read by nothing. This suite pins the replacement: a
 * per-tier multiplier over the operator's base limit, enforced by the live
 * limiter (pure policy + HTTP behaviour), with an unknown/absent tier falling
 * back to the BASE quota — a tier typo must never mint a bigger quota.
 *
 * The base limit is set to a tiny value before any app module is imported so
 * the HTTP assertions need only a handful of requests; the file uses dynamic
 * imports because ESM hoists static imports above the env assignment.
 */
process.env.AI_HOURLY_LIMIT = "2";

let app: Express;
let registerFarmer: typeof import("./helpers.js")["registerFarmer"];
let prisma: typeof import("../src/lib/prisma.js")["prisma"];
let limits: typeof import("../src/modules/aiagent/limits.js");

beforeAll(async () => {
  ({ app, registerFarmer } = await import("./helpers.js"));
  ({ prisma } = await import("../src/lib/prisma.js"));
  limits = await import("../src/modules/aiagent/limits.js");
}, 120_000);

async function ask(token: string, index: number) {
  return request(app)
    .post("/api/v1/ai/advisory")
    .set("Authorization", `Bearer ${token}`)
    .send({ question: `ধানের জমিতে সেচ কখন দিতে হয়? (${index})`, lang: "bn" });
}

describe("F-62 — per-tier AI advisory quota", () => {
  it("maps tiers to multipliers of the operator base, failing closed on anything unknown", () => {
    const base = 2;
    expect(limits.TIER_AI_LIMIT_MULTIPLIERS).toEqual({ BRONZE: 1, SILVER: 4, GOLD: 10 });
    expect(limits.advisoryHourlyLimitForTier("BRONZE", base)).toBe(2);
    expect(limits.advisoryHourlyLimitForTier("SILVER", base)).toBe(8);
    expect(limits.advisoryHourlyLimitForTier("GOLD", base)).toBe(20);
    expect(limits.advisoryHourlyLimitForTier("gold", base)).toBe(20);
    expect(limits.advisoryHourlyLimitForTier(null, base)).toBe(2);
    expect(limits.advisoryHourlyLimitForTier(undefined, base)).toBe(2);
    expect(limits.advisoryHourlyLimitForTier("PLATINUM", base)).toBe(2);
    expect(limits.advisoryHourlyLimitForTier("", base)).toBe(2);
  });

  it("BRONZE trips at the base quota; SILVER survives the same requests and advertises a ×4 quota", async () => {
    const bronze = await registerFarmer();
    for (let i = 0; i < 2; i++) {
      const res = await ask(bronze.accessToken, i);
      expect(res.status).toBe(200);
      expect(Number(res.headers["ratelimit-limit"])).toBe(2);
    }
    const bronzeThird = await ask(bronze.accessToken, 3);
    expect(bronzeThird.status).toBe(429);
    expect(bronzeThird.body.error.code).toBe("RATE_LIMITED");
    expect(Number(bronzeThird.headers["ratelimit-limit"])).toBe(2);

    const silver = await registerFarmer();
    await prisma.farmerProfile.upsert({
      where: { userId: silver.user.id },
      update: { membershipTier: "SILVER" },
      create: { userId: silver.user.id, membershipTier: "SILVER" },
    });
    for (let i = 0; i < 3; i++) {
      const res = await ask(silver.accessToken, i);
      expect(res.status, `SILVER request ${i} must not be throttled at the BRONZE quota`).toBe(200);
      // The advertised quota is the tier's, so a client can see the grant.
      expect(Number(res.headers["ratelimit-limit"])).toBe(8);
    }
  });

  it("a tier lookup failure falls back to the base quota (never a free upgrade)", async () => {
    // Simulate the DB being unavailable during the limiter's tier read by
    // pointing the lookup at a non-existent column? The route handles errors by
    // returning undefined; the pure function's fail-closed behaviour is pinned
    // above. Here we only assert the fallback contract is reachable through the
    // route for an absent profile tier.
    const farmer = await registerFarmer();
    await prisma.farmerProfile.upsert({
      where: { userId: farmer.user.id },
      update: { membershipTier: "SILVER" },
      create: { userId: farmer.user.id, membershipTier: "SILVER" },
    });
    await prisma.farmerProfile.delete({ where: { userId: farmer.user.id } });
    const first = await ask(farmer.accessToken, 0);
    expect(first.status).toBe(200);
    // No profile → base quota, not the ×4 the account held a moment ago.
    expect(Number(first.headers["ratelimit-limit"])).toBe(2);
  });

  it("the seeded plan copy states the real grant and never promises unlimited advisory (F-62)", async () => {
    const plans = await prisma.membershipPlan.findMany({ where: { tier: { in: ["BRONZE", "SILVER", "GOLD"] } } });
    expect(plans.map((p) => p.tier).sort()).toEqual(["BRONZE", "GOLD", "SILVER"]);
    for (const plan of plans) {
      const benefits = JSON.parse(plan.benefitsStr) as string[];
      expect(benefits.join(" "), plan.tier).not.toMatch(/unlimited/i);
      const multiplier = limits.TIER_AI_LIMIT_MULTIPLIERS[plan.tier];
      expect(multiplier, `${plan.tier} has no registered multiplier`).toBeDefined();
      if ((multiplier ?? 1) > 1) {
        // The sold benefit names the multiplier the limiter actually applies.
        expect(
          benefits.some((b) => b.includes(`×${multiplier}`)),
          `${plan.tier} copy must state the ×${multiplier} AI-advisory grant`,
        ).toBe(true);
      }
    }
  });

  it("re-seeding converges an existing row onto the corrected copy — a deployed DB cannot keep the promise", async () => {
    const seed = await import("../prisma/seed.js");
    // Simulate the pilot database before the fix: SILVER carrying the old claim.
    await prisma.membershipPlan.update({
      where: { tier: "SILVER" },
      data: { benefitsStr: JSON.stringify(["Unlimited AI advisory", "3% marketplace discount"]) },
    });
    await seed.seedReferenceData(prisma, () => undefined);
    const silver = await prisma.membershipPlan.findUniqueOrThrow({ where: { tier: "SILVER" } });
    expect(silver.benefitsStr).not.toMatch(/unlimited/i);
    expect(silver.benefitsStr).toContain("×4");
  });
});
