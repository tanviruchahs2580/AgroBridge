import { prisma } from "../../lib/prisma.js";
import { liveGroundedRefs } from "../aiagent/routes.js";

/**
 * Personal-data export (AUD-130 / GDPR-style access request).
 *
 * Collects everything AgroBridge stores about ONE user into a single
 * JSON-serialisable object. Guarantees, tested in tests/auth-export.test.ts:
 *  - every query is scoped to `userId` — another user's rows can never leak in;
 *  - `passwordHash` is never selected (explicit selects everywhere);
 *  - disease cases are metadata only (this model stores no image bytes, only
 *    the storage key in `imagePath`; bytes stay in the storage provider).
 *
 * Advisory history re-applies the live-KB ref filter the `/ai/history` route
 * uses (AUD-110b), so an export never cites a knowledge-base entry that has
 * since been removed.
 */
export async function collectUserData(userId: string): Promise<Record<string, unknown>> {
  const [
    profile,
    farms,
    orders,
    payments,
    wallet,
    walletTransactions,
    bookings,
    procurementOffers,
    diseaseCases,
    notifications,
    advisoryQueries,
    organizationMemberships,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        fullName: true,
        role: true,
        langPref: true,
        status: true,
        region: true,
        phoneVerified: true,
        notificationPrefs: true,
        createdAt: true,
        updatedAt: true,
        farmerProfile: true,
      },
    }),
    prisma.farm.findMany({
      where: { ownerId: userId },
      include: {
        plots: { include: { cropCycles: true } },
        farmEvents: true,
      },
    }),
    prisma.order.findMany({ where: { userId }, include: { items: true } }),
    // Reference/status/amount fields only — the gateway metadata blob
    // (`metaStr`) is operational, not personal, data.
    prisma.payment.findMany({
      where: { userId },
      select: {
        id: true,
        refNo: true,
        purposeType: true,
        purposeId: true,
        amountPaisa: true,
        method: true,
        providerRef: true,
        status: true,
        refundedAt: true,
        refundRef: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.booking.findMany({ where: { userId } }),
    // "Procurement offers" = ProcurementOrder rows (farmer → buyer crop offers).
    prisma.procurementOrder.findMany({ where: { userId } }),
    prisma.diseaseCase.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.advisoryQuery.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        question: true,
        answer: true,
        confidence: true,
        provider: true,
        model: true,
        lowConfidenceFlag: true,
        groundedRefs: true,
        feedbackReason: true,
        feedbackAt: true,
        createdAt: true,
      },
    }),
    prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: { select: { id: true, name: true, type: true, district: true } } },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    user: profile,
    farms,
    orders,
    payments,
    wallet: wallet ? { balancePaisa: wallet.balancePaisa, heldPaisa: wallet.heldPaisa } : null,
    walletTransactions,
    bookings,
    procurementOffers,
    diseaseCases,
    notifications,
    advisoryQueries: advisoryQueries.map(({ groundedRefs, ...row }) => ({
      ...row,
      groundedRefs: liveGroundedRefs(groundedRefs),
    })),
    organizationMemberships,
  };
}
