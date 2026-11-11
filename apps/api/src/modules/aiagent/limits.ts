/**
 * Per-tier AI advisory quota (F-62).
 *
 * The seed advertised "Unlimited AI advisory" on SILVER/GOLD while every
 * account was capped at the flat `AI_HOURLY_LIMIT` (default 30) — a sold
 * benefit the code did not grant. Paid tiers now get a multiple of the
 * operator's base limit, and the benefit copy states the grant.
 *
 * The quota must never depend on a client-supplied tier: the caller's tier is
 * read from the database by the route and an unknown/absent tier falls back to
 * the base limit (fail closed — a typo can never mint a bigger quota).
 */
export const TIER_AI_LIMIT_MULTIPLIERS: Record<string, number> = {
  BRONZE: 1,
  SILVER: 4,
  GOLD: 10,
};

export function advisoryHourlyLimitForTier(tier: string | null | undefined, baseLimit: number): number {
  const key = typeof tier === "string" ? tier.trim().toUpperCase() : "";
  const multiplier = Object.prototype.hasOwnProperty.call(TIER_AI_LIMIT_MULTIPLIERS, key) ? TIER_AI_LIMIT_MULTIPLIERS[key] : 1;
  return Math.max(1, Math.round(baseLimit * multiplier));
}
