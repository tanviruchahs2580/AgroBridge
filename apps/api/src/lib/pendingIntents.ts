import type { Prisma } from "@prisma/client";

/**
 * Voids every PENDING payment intent belonging to one business object (order,
 * booking) so a payment can no longer settle against it.
 *
 * Cancelling and settling are both claims on the same payment row: the void
 * below and the `PENDING -> SUCCEEDED` claim in `claimAndApplyPayment` / the
 * gateway webhook both condition on `status: "PENDING"`, so exactly one of the
 * two wins. That is what stops a cancelled order from being flipped to PAID
 * after its stock was already returned to the pool — the payment instead finds
 * a terminal FAILED row and answers `processed:false`, which is the
 * reconciliation case rather than a false success.
 *
 * Call this INSIDE the cancelling transaction, before the state transition, so
 * a failed transition rolls the void back with it.
 */
export async function voidPendingIntents(
  tx: Prisma.TransactionClient,
  params: { purposeType: "ORDER" | "BOOKING" | "MEMBERSHIP"; purposeId: string; userId: string; reason: string }
): Promise<number> {
  const voided = await tx.payment.updateMany({
    where: {
      purposeType: params.purposeType,
      purposeId: params.purposeId,
      userId: params.userId,
      status: "PENDING",
    },
    // Same shape as the supersede in POST /payments/intent: a terminal FAILED
    // row that records why, so support and the reconcile script can tell a
    // cancelled intent from an expired one.
    data: { status: "FAILED", metaStr: JSON.stringify({ cancelledReason: params.reason }) },
  });
  return voided.count;
}
