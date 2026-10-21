import { randomBytes } from "node:crypto";

export function refNo(prefix: string): string {
  const t = new Date();
  const ymd = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`;
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

/** Membership discount percent per tier (configurable source of truth = MembershipPlan table benefits; this is the enforced engine). */
export const TIER_DISCOUNT_PCT: Record<string, number> = {
  BRONZE: 0,
  SILVER: 3,
  GOLD: 5,
};

export function tierDiscountPct(tier: string | null | undefined): number {
  const key = tier ?? "BRONZE";
  // Own-property lookup, not a bare index: `TIER_DISCOUNT_PCT["toString"]`
  // would return the inherited Object.prototype function and poison the
  // checkout arithmetic with NaN (the API-04 property tests found this).
  return Object.hasOwn(TIER_DISCOUNT_PCT, key) ? TIER_DISCOUNT_PCT[key] : 0;
}

/** Procurement quality grade price multipliers — auditable calculation. */
export const GRADE_MULTIPLIER: Record<string, number> = {
  A: 1.0,
  B: 0.92,
  C: 0.8,
};

/**
 * Auditable procurement price calculation.
 * moisture above baseMoisturePct => 0.5% deduction of net per extra point.
 */
export function calcProcurement(input: {
  quantityKg: number;
  basePricePerKgPaisa: number;
  grade: string;
  moisturePct?: number;
}) {
  // Own-property lookup: an inherited key like "toString" is not a grade and
  // must be refused, not multiplied with (API-04 property tests).
  const gradeMult = Object.hasOwn(GRADE_MULTIPLIER, input.grade) ? GRADE_MULTIPLIER[input.grade] : undefined;
  if (!gradeMult) throw new Error(`Unknown quality grade: ${input.grade}`);
  const grossPaisa = Math.round(input.quantityKg * input.basePricePerKgPaisa * gradeMult);
  const extraMoisture = input.moisturePct != null ? Math.max(0, input.moisturePct - 14) : 0;
  const deductionsPaisa = Math.round(grossPaisa * (extraMoisture * 0.005));
  return { grossPaisa, deductionsPaisa, netPayablePaisa: grossPaisa - deductionsPaisa };
}

/** Flat marketplace delivery fee (paisa) and the subtotal at/above which it is waived. */
export const DELIVERY_FEE_PAISA = 5_000; // BDT 50
export const FREE_DELIVERY_THRESHOLD_PAISA = 500_000; // BDT 5000

/**
 * Marketplace checkout totals — the enforced money engine for `POST /orders/checkout`:
 * tier discount applied to the subtotal (round to nearest paisa), plus the flat
 * delivery fee unless the subtotal reaches the free-delivery threshold.
 */
export function orderTotals(
  subtotalPaisa: number,
  discountPct: number
): { discountPaisa: number; deliveryFeePaisa: number; totalPaisa: number } {
  const discountPaisa = Math.round((subtotalPaisa * discountPct) / 100);
  const deliveryFeePaisa = subtotalPaisa >= FREE_DELIVERY_THRESHOLD_PAISA ? 0 : DELIVERY_FEE_PAISA;
  return { discountPaisa, deliveryFeePaisa, totalPaisa: subtotalPaisa - discountPaisa + deliveryFeePaisa };
}
