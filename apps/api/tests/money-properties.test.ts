import { describe, expect, it } from "vitest";
import request from "supertest";
import fc from "fast-check";
import { app, createFarmWithCrop, getAdmin, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import {
  DELIVERY_FEE_PAISA,
  FREE_DELIVERY_THRESHOLD_PAISA,
  GRADE_MULTIPLIER,
  TIER_DISCOUNT_PCT,
  calcProcurement,
  orderTotals,
  tierDiscountPct,
} from "../src/shared/utils/money.js";

/**
 * API-04: property-based tests over the enforced money engine
 * (src/shared/utils/money.ts). These are the invariants that must hold for
 * EVERY input, not just the examples the unit tests pick: integer paisa,
 * non-negativity, monotonicity, and rounding within one paisa of exact
 * rational arithmetic. Runs are bounded (200) to keep CI fast.
 *
 * The rating-claim block at the bottom pins the same "exactly one write wins"
 * contract under parallel submissions.
 */
const RUNS = 200;

const subtotalArb = fc.integer({ min: 0, max: 5_000_000 }); // up to BDT 50,000
const pctArb = fc.constantFrom(...Object.values(TIER_DISCOUNT_PCT), 0);
const gradeArb = fc.constantFrom("A", "B", "C");

describe("money properties — marketplace totals", () => {
  it("always produces integer, non-negative paisa for non-negative inputs", () => {
    fc.assert(
      fc.property(subtotalArb, pctArb, (subtotal, pct) => {
        const { discountPaisa, deliveryFeePaisa, totalPaisa } = orderTotals(subtotal, pct);
        for (const v of [discountPaisa, deliveryFeePaisa, totalPaisa]) {
          expect(Number.isInteger(v)).toBe(true);
        }
        expect(discountPaisa).toBeGreaterThanOrEqual(0);
        expect(deliveryFeePaisa).toBeGreaterThanOrEqual(0);
        expect(totalPaisa).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: RUNS }
    );
  });

  it("rounds the tier discount to the nearest paisa (within 1 paisa of exact rational arithmetic) and never exceeds the configured percent by more than that rounding", () => {
    fc.assert(
      fc.property(subtotalArb, pctArb, (subtotal, pct) => {
        const { discountPaisa } = orderTotals(subtotal, pct);
        // Exact in integer arithmetic: discount = subtotal × pct / 100 rounded to
        // the nearest paisa ⇔ |100·discount − subtotal·pct| ≤ 50.
        expect(Math.abs(100 * discountPaisa - subtotal * pct)).toBeLessThanOrEqual(50);
        // The configured percent is therefore never exceeded by a full paisa.
        expect(discountPaisa).toBeLessThanOrEqual(Math.floor((subtotal * pct) / 100) + 1);
      }),
      { numRuns: RUNS }
    );
  });

  it("waives the delivery fee exactly at the configured threshold and keeps total = subtotal − discount + fee", () => {
    fc.assert(
      fc.property(subtotalArb, pctArb, (subtotal, pct) => {
        const { discountPaisa, deliveryFeePaisa, totalPaisa } = orderTotals(subtotal, pct);
        if (subtotal >= FREE_DELIVERY_THRESHOLD_PAISA) expect(deliveryFeePaisa).toBe(0);
        else expect(deliveryFeePaisa).toBe(DELIVERY_FEE_PAISA);
        expect(totalPaisa).toBe(subtotal - discountPaisa + deliveryFeePaisa);
      }),
      { numRuns: RUNS }
    );
  });

  it("is monotonic in the subtotal within one delivery-fee regime", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FREE_DELIVERY_THRESHOLD_PAISA - 1 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        pctArb,
        (a, delta, pct) => {
          // Both points stay below the threshold (fee constant), so the
          // discounted subtotal can only grow.
          const b = Math.min(a + delta, FREE_DELIVERY_THRESHOLD_PAISA - 1);
          expect(orderTotals(a, pct).totalPaisa).toBeLessThanOrEqual(orderTotals(b, pct).totalPaisa);
        }
      ),
      { numRuns: RUNS }
    );
    fc.assert(
      fc.property(fc.integer({ min: FREE_DELIVERY_THRESHOLD_PAISA, max: 4_999_999 }), fc.integer({ min: 0, max: 1_000_000 }), pctArb, (a, delta, pct) => {
        // Above the threshold the fee is waived, so the same monotonicity holds.
        const b = Math.min(a + delta, 5_000_000);
        expect(orderTotals(a, pct).totalPaisa).toBeLessThanOrEqual(orderTotals(b, pct).totalPaisa);
      }),
      { numRuns: RUNS }
    );
  });

  it("only ever applies a configured tier's own percent — unknown tiers fall back to 0", () => {
    fc.assert(
      fc.property(fc.string(), (tier) => {
        const pct = tierDiscountPct(tier);
        // Own-property lookup here too: a bare index would read
        // Object.prototype["valueOf"] and compare a function against a number.
        const configured = Object.hasOwn(TIER_DISCOUNT_PCT, tier) ? TIER_DISCOUNT_PCT[tier] : 0;
        expect(pct).toBe(configured);
        expect([0, 3, 5]).toContain(pct);
      }),
      { numRuns: RUNS }
    );
  });
});

describe("money properties — procurement pricing", () => {
  const qtyArb = fc.integer({ min: 1, max: 1_000_000 });
  const baseArb = fc.integer({ min: 1, max: 100_000 });
  // The route's enforced moisture domain: 0..60 (procurement submitSchema).
  const moistureArb = fc.integer({ min: 0, max: 60 });

  it("always produces integer, non-negative paisa within the route's input domain", () => {
    fc.assert(
      fc.property(qtyArb, baseArb, gradeArb, moistureArb, (quantityKg, basePricePerKgPaisa, grade, moisturePct) => {
        const { grossPaisa, deductionsPaisa, netPayablePaisa } = calcProcurement({ quantityKg, basePricePerKgPaisa, grade, moisturePct });
        for (const v of [grossPaisa, deductionsPaisa, netPayablePaisa]) expect(Number.isInteger(v)).toBe(true);
        expect(grossPaisa).toBeGreaterThanOrEqual(0);
        expect(deductionsPaisa).toBeGreaterThanOrEqual(0);
        expect(netPayablePaisa).toBeGreaterThanOrEqual(0);
        expect(netPayablePaisa).toBe(grossPaisa - deductionsPaisa);
      }),
      { numRuns: RUNS }
    );
  });

  it("keeps gross and the moisture deduction within 1 paisa of exact rational arithmetic", () => {
    fc.assert(
      fc.property(qtyArb, baseArb, gradeArb, moistureArb, (quantityKg, basePricePerKgPaisa, grade, moisturePct) => {
        const { grossPaisa, deductionsPaisa } = calcProcurement({ quantityKg, basePricePerKgPaisa, grade, moisturePct });
        const exactGross = quantityKg * basePricePerKgPaisa * GRADE_MULTIPLIER[grade];
        expect(Math.abs(grossPaisa - exactGross)).toBeLessThanOrEqual(0.5);
        const exactDeduction = grossPaisa * (Math.max(0, moisturePct - 14) * 0.005);
        expect(Math.abs(deductionsPaisa - exactDeduction)).toBeLessThanOrEqual(0.5);
      }),
      { numRuns: RUNS }
    );
  });

  it("pays lower or equal for higher moisture at the same grade, quantity and base price", () => {
    fc.assert(
      fc.property(qtyArb, baseArb, gradeArb, moistureArb, fc.integer({ min: 0, max: 60 }), (quantityKg, basePricePerKgPaisa, grade, m1, extra) => {
        const m2 = Math.min(m1 + extra, 60);
        const dry = calcProcurement({ quantityKg, basePricePerKgPaisa, grade, moisturePct: m1 });
        const wet = calcProcurement({ quantityKg, basePricePerKgPaisa, grade, moisturePct: m2 });
        expect(wet.grossPaisa).toBe(dry.grossPaisa); // moisture never changes gross
        expect(wet.netPayablePaisa).toBeLessThanOrEqual(dry.netPayablePaisa);
      }),
      { numRuns: RUNS }
    );
  });

  it("pays higher or equal for higher quantity at the same grade, base price and moisture", () => {
    fc.assert(
      fc.property(qtyArb, fc.integer({ min: 0, max: 1_000_000 }), baseArb, gradeArb, moistureArb, (a, delta, basePricePerKgPaisa, grade, moisturePct) => {
        const b = Math.min(a + delta, 1_000_000);
        const small = calcProcurement({ quantityKg: a, basePricePerKgPaisa, grade, moisturePct });
        const large = calcProcurement({ quantityKg: b, basePricePerKgPaisa, grade, moisturePct });
        expect(large.grossPaisa).toBeGreaterThanOrEqual(small.grossPaisa);
        expect(large.netPayablePaisa).toBeGreaterThanOrEqual(small.netPayablePaisa);
      }),
      { numRuns: RUNS }
    );
  });

  it("orders grades A ≥ B ≥ C for the same quantity, base price and moisture", () => {
    fc.assert(
      fc.property(qtyArb, baseArb, moistureArb, (quantityKg, basePricePerKgPaisa, moisturePct) => {
        const a = calcProcurement({ quantityKg, basePricePerKgPaisa, grade: "A", moisturePct }).netPayablePaisa;
        const b = calcProcurement({ quantityKg, basePricePerKgPaisa, grade: "B", moisturePct }).netPayablePaisa;
        const c = calcProcurement({ quantityKg, basePricePerKgPaisa, grade: "C", moisturePct }).netPayablePaisa;
        expect(a).toBeGreaterThanOrEqual(b);
        expect(b).toBeGreaterThanOrEqual(c);
      }),
      { numRuns: RUNS }
    );
  });

  it("deducts nothing at or below the 14% base moisture and rejects unknown grades", () => {
    fc.assert(
      fc.property(qtyArb, baseArb, gradeArb, fc.integer({ min: 0, max: 14 }), (quantityKg, basePricePerKgPaisa, grade, moisturePct) => {
        expect(calcProcurement({ quantityKg, basePricePerKgPaisa, grade, moisturePct }).deductionsPaisa).toBe(0);
      }),
      { numRuns: RUNS }
    );
    // Prototype-chain names are not grades either: a bare index lookup used to
    // return the inherited function and silently produce NaN.
    for (const grade of ["Z", "toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => calcProcurement({ quantityKg: 100, basePricePerKgPaisa: 3_200, grade })).toThrow(/Unknown quality grade/);
    }
    for (const tier of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(tierDiscountPct(tier)).toBe(0);
    }
  });
});

/**
 * API-04 follow-up (AUD-122): the rating route already writes through a
 * conditional `updateMany({ where: { status: COMPLETED, rating: null } })`
 * claim; this pins the parallel case — two racing submissions must produce
 * exactly one 200 and one 409, and the provider aggregate must move once.
 */
describe("booking rating claim is atomic under parallel submissions", () => {
  async function completedBookingWithProvider(token: string) {
    const farm = await createFarmWithCrop(token);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${token}`);
    const svc = services.body.data.find((s: { code: string }) => s.code === "POWER_TILLER");
    const provider = svc.providers[0] as { id: string; ratingSum: number; ratingCount: number };
    const booking = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        farmId: farm.farmId,
        serviceId: svc.id,
        providerId: provider.id,
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        areaBigha: 1,
      });
    expect(booking.status).toBe(201);
    const admin = await getAdmin();
    const completed = await request(app)
      .post(`/api/v1/bookings/${booking.body.data.id}/status`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "COMPLETED" });
    expect(completed.status).toBe(200);
    return { bookingId: booking.body.data.id as string, provider };
  }

  it("two parallel ratings yield exactly one row update and one provider aggregate increment", async () => {
    const f = await registerFarmer();
    const { bookingId, provider } = await completedBookingWithProvider(f.accessToken);

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/bookings/${bookingId}/rating`).set("Authorization", `Bearer ${f.accessToken}`).send({ rating: 5 }),
      request(app).post(`/api/v1/bookings/${bookingId}/rating`).set("Authorization", `Bearer ${f.accessToken}`).send({ rating: 2 }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? 5 : 2;

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.rating).toBe(winner);

    const after = await prisma.serviceProvider.findUniqueOrThrow({ where: { id: provider.id } });
    expect(after.ratingCount).toBe(provider.ratingCount + 1);
    expect(after.ratingSum).toBe(provider.ratingSum + winner);
  });
});
