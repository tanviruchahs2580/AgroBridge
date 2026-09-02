import { prisma } from "../../lib/prisma.js";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";
import { refNo } from "../../lib/money.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import type { TransactionClient } from "./payment.repository.js";

/**
 * Refund domain service — supports two branches:
 *  - FINANCIAL: compensating ledger DEBIT against the payer's wallet
 *    (balance may go negative on deliberate refunds — documented ops behaviour).
 *  - INVENTORY RESTOCK: for ORDER refunds where goods are returned, re-increment
 *    Product.stockQty for each OrderItem (extensible to batch/expiry tracking).
 *
 * Both branches share the same idempotent claim (SUCCEEDED -> REFUNDED).
 */

export type RefundBranch = "FINANCIAL" | "RESTOCK";

export type RefundInput = {
  paymentId: string;
  actorId: string;
  reason: string;
  branch?: RefundBranch; // default FINANCIAL for backward compat
};

export async function refundPayment(input: RefundInput) {
  const branch: RefundBranch = input.branch ?? "FINANCIAL";

  const payment = await prisma.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw notFound("Payment");
  if (payment.purposeType === "MEMBERSHIP") {
    throw unprocessable("Membership purchases are non-refundable while active (see Terms)");
  }
  if (payment.purposeType !== "ORDER") {
    throw unprocessable(`Refunds for ${payment.purposeType} are not supported yet`);
  }

  const result = await prisma.$transaction(
    async (tx: TransactionClient) => {
      // Atomic claim: only one refund can transition SUCCEEDED -> REFUNDED.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: "SUCCEEDED" },
        data: { status: "REFUNDED", refundedAt: new Date(), refundRef: refNo("RFND") },
      });
      if (claimed.count !== 1) throw conflict(`Payment already ${payment.status}`);

      await tx.order.updateMany({
        where: { id: payment.purposeId, paymentStatus: "PAID" },
        data: { status: "REFUNDED", paymentStatus: "REFUNDED" },
      });

      if (branch === "RESTOCK") {
        // Inventory branch — restock each product from the order.
        // Order -> OrderItems -> Products; increment stockQty atomically.
        const order = await tx.order.findUnique({
          where: { id: payment.purposeId },
          include: { items: true },
        });
        if (order?.items?.length) {
          for (const item of order.items as Array<{ productId: string; qty: number }>) {
            await tx.product.updateMany({
              where: { id: item.productId },
              data: { stockQty: { increment: item.qty } },
            });
          }
        }
        // Even with restock we still emit a compensating ledger entry so
        // financial audit trail is complete (double-entry ready).
      }

      // FINANCIAL branch (always) — compensating ledger entry.
      // For RESTOCK we still record the financial reversal for audit;
      // callers that want inventory-only refunds can be extended with
      // a flag to skip this block if business rules change.
      const wallet = await tx.wallet.upsert({
        where: { userId: payment.userId },
        update: { balancePaisa: { decrement: payment.amountPaisa } },
        create: { userId: payment.userId, balancePaisa: -payment.amountPaisa },
      });
      await tx.walletTransaction.create({
        data: {
          userId: payment.userId,
          direction: "DEBIT",
          amountPaisa: payment.amountPaisa,
          reason: `Refund ${payment.refNo}${branch === "RESTOCK" ? " (restock)" : ""}`,
          balanceAfterPaisa: wallet.balancePaisa,
          refType: "PAYMENT",
          refId: payment.id,
        },
      });

      if (branch === "RESTOCK") {
        // Optional: credit inventory-hold wallet or annotate that goods were returned.
        // No-op today beyond stockQty increment + ledger; placeholder for
        // future double-entry (inventory asset vs liability).
      }

      return { refundRef: `RFND-${payment.id}` };
    },
    { timeout: 15000, maxWait: 8000 },
  );

  const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

  await audit({
    actorId: input.actorId,
    action: "PAYMENT_REFUNDED",
    entityType: "Payment",
    entityId: payment.id,
    meta: { reason: input.reason, branch },
  });

  await notify({
    userId: payment.userId,
    type: "PAYMENT",
    category: "CRITICAL",
    titleBn: `টাকা ফেরত (${updated.refundRef})`,
    titleEn: `Refund processed (${result.refundRef})`,
    bodyBn: "আপনার পেমেন্ট ফেরত দেওয়া হয়েছে।",
    bodyEn: "Your payment has been refunded.",
    refType: "PAYMENT",
    refId: payment.id,
  });

  return updated;
}

// Backward-compatible alias for callers that expect the old name
export const processRefund = refundPayment;
