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
  return TIER_DISCOUNT_PCT[tier ?? "BRONZE"] ?? 0;
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
  const gradeMult = GRADE_MULTIPLIER[input.grade];
  if (!gradeMult) throw new Error(`Unknown quality grade: ${input.grade}`);
  const grossPaisa = Math.round(input.quantityKg * input.basePricePerKgPaisa * gradeMult);
  const extraMoisture = input.moisturePct != null ? Math.max(0, input.moisturePct - 14) : 0;
  const deductionsPaisa = Math.round(grossPaisa * (extraMoisture * 0.005));
  return { grossPaisa, deductionsPaisa, netPayablePaisa: grossPaisa - deductionsPaisa };
}
