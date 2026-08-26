import { prisma } from "./prisma.js";
import { tierDiscountPct } from "./money.js";

export type MembershipInfo = { tier: string; expiresAt: Date | null; discountPct: number };

/**
 * Membership with expiry awareness. A tier whose expiresAt has passed
 * degrades to BRONZE (no discount) without mutating the stored profile —
 * renewal simply refreshes the row.
 */
export async function getActiveMembership(userId: string): Promise<MembershipInfo> {
  const profile = await prisma.farmerProfile.findUnique({
    where: { userId },
    select: { membershipTier: true, membershipExpiresAt: true },
  });
  if (!profile) return { tier: "BRONZE", expiresAt: null, discountPct: 0 };
  if (profile.membershipExpiresAt && profile.membershipExpiresAt < new Date()) {
    return { tier: "BRONZE", expiresAt: profile.membershipExpiresAt, discountPct: 0 };
  }
  return {
    tier: profile.membershipTier,
    expiresAt: profile.membershipExpiresAt,
    discountPct: tierDiscountPct(profile.membershipTier),
  };
}
