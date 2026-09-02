import { prisma } from "../../lib/prisma.js";

/**
 * Thin Prisma wrapper for the Payments bounded context.
 * Keeps query shapes in one place so services can remain pure
 * (no inline `prisma.xxx.find...` scattered across business logic).
 *
 * Every method accepts an optional TransactionClient `tx` so callers
 * inside `$transaction` can pass the interactive tx through.
 */

export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type DbClient = typeof prisma | TransactionClient;

// helper to pick the right client
function db(tx?: DbClient): DbClient {
  return tx ?? prisma;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function findPaymentById(id: string, tx?: DbClient) {
  return db(tx).payment.findUnique({ where: { id } });
}

export async function findPaymentByRefNo(refNo: string, tx?: DbClient) {
  return db(tx).payment.findFirst({ where: { refNo } });
}

export async function findPaymentForUser(id: string, userId: string, tx?: DbClient) {
  return db(tx).payment.findFirst({ where: { id, userId } });
}

export async function listPayments(where: Record<string, unknown>, take = 100, tx?: DbClient) {
  return db(tx).payment.findMany({
    where: where as never,
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function createPayment(
  data: {
    refNo: string;
    userId: string;
    purposeType: string;
    purposeId: string;
    amountPaisa: number;
    method?: string;
    providerRef?: string;
    metaStr?: string;
    status?: string;
  },
  tx?: DbClient,
) {
  return db(tx).payment.create({
    data: {
      refNo: data.refNo,
      userId: data.userId,
      purposeType: data.purposeType,
      purposeId: data.purposeId,
      amountPaisa: data.amountPaisa,
      method: data.method ?? "MOBILE_WALLET",
      providerRef: data.providerRef,
      metaStr: data.metaStr,
      status: data.status,
    },
  });
}

export async function claimPaymentPendingToSucceeded(id: string, tx: DbClient) {
  return (tx as TransactionClient).payment.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "SUCCEEDED" },
  });
}

export async function claimPaymentSucceededToRefunded(
  id: string,
  data: { refundRef: string; refundedAt: Date },
  tx: DbClient,
) {
  return (tx as TransactionClient).payment.updateMany({
    where: { id, status: "SUCCEEDED" },
    data: { status: "REFUNDED", refundRef: data.refundRef, refundedAt: data.refundedAt },
  });
}

export async function supersedePendingPayments(
  purposeType: string,
  purposeId: string,
  tx: DbClient,
) {
  return (tx as TransactionClient).payment.updateMany({
    where: { purposeType, purposeId, status: "PENDING" },
    data: {
      status: "FAILED",
      metaStr: JSON.stringify({ cancelledReason: "superseded_by_new_intent" }),
    },
  });
}

// ---------------------------------------------------------------------------
// Payable entities
// ---------------------------------------------------------------------------

export async function findPayableOrder(orderId: string, userId: string, tx?: DbClient) {
  return db(tx).order.findFirst({
    where: { id: orderId, userId, status: { in: ["CONFIRMED", "PENDING"] }, paymentStatus: "UNPAID" },
  });
}

export async function findPayableBooking(bookingId: string, userId: string, tx?: DbClient) {
  return db(tx).booking.findFirst({
    where: { id: bookingId, userId, paymentStatus: "UNPAID", status: { in: ["REQUESTED", "ASSIGNED"] } },
  });
}

export async function findMembershipPlan(tier: string, tx?: DbClient) {
  return db(tx).membershipPlan.findUnique({ where: { tier } });
}

export async function findProcurementOrderWithUser(poId: string, tx?: DbClient) {
  return db(tx).procurementOrder.findUnique({
    where: { id: poId },
    include: { user: { select: { phoneVerified: true } } },
  });
}

// ---------------------------------------------------------------------------
// Orders / Bookings / FarmerProfile side-effects (used inside transactions)
// ---------------------------------------------------------------------------

export async function markOrderPaid(purposeId: string, tx: DbClient) {
  return (tx as TransactionClient).order.updateMany({
    where: { id: purposeId, paymentStatus: "UNPAID" },
    data: { status: "PAID", paymentStatus: "PAID" },
  } as never);
}

export async function markBookingPaid(purposeId: string, tx: DbClient) {
  return (tx as TransactionClient).booking.updateMany({
    where: { id: purposeId, paymentStatus: "UNPAID" },
    data: { paymentStatus: "PAID" },
  } as never);
}

export async function upsertFarmerMembership(
  userId: string,
  tier: string,
  expiresAt: Date,
  tx: DbClient,
) {
  return (tx as TransactionClient).farmerProfile.upsert({
    where: { userId },
    update: { membershipTier: tier, membershipExpiresAt: expiresAt },
    create: { userId, membershipTier: tier, membershipExpiresAt: expiresAt },
  } as never);
}

export async function markOrderRefunded(purposeId: string, tx: DbClient) {
  return (tx as TransactionClient).order.updateMany({
    where: { id: purposeId, paymentStatus: "PAID" },
    data: { status: "REFUNDED", paymentStatus: "REFUNDED" },
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export const paymentRepository = {
  findPaymentById,
  findPaymentByRefNo,
  findPaymentForUser,
  listPayments,
  createPayment,
  claimPaymentPendingToSucceeded,
  claimPaymentSucceededToRefunded,
  supersedePendingPayments,
  findPayableOrder,
  findPayableBooking,
  findMembershipPlan,
  findProcurementOrderWithUser,
  markOrderPaid,
  markBookingPaid,
  upsertFarmerMembership,
  markOrderRefunded,
};
