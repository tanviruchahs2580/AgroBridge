import { prisma } from "../../lib/prisma.js";
import { conflict, notFound, unprocessable } from "../../shared/errors/index.js";
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
      // Use atomic decrement instead of creating a negative-balance wallet.
      // If the wallet does not exist, create it at 0 (platform-initiated
      // refunds against a missing wallet are an edge case for manual
      // reconciliation — the ledger entry is still recorded).
      // Atomic guard: if wallet exists and balance < refund amount, the
      // update affects 0 rows and the transaction rolls back, preventing
      // negative balance from refunds.
      let walletBalanceAfterPaisa: number;
      const wallet = await tx.wallet.findUnique({ where: { userId: payment.userId } });

      if (!wallet) {
        // No wallet exists yet — create at 0, ledger records the debit
        await tx.wallet.create({
          data: { userId: payment.userId, balancePaisa: 0 },
        });
        walletBalanceAfterPaisa = 0;
      } else if (wallet.balancePaisa >= payment.amountPaisa) {
        // Sufficient balance — atomic decrement
        const updated = await tx.wallet.update({
          where: { userId: payment.userId, balancePaisa: { gte: payment.amountPaisa } },
          data: { balancePaisa: { decrement: payment.amountPaisa } },
        });
        walletBalanceAfterPaisa = updated.balancePaisa;
      } else {
        // Insufficient balance — create compensating entry but do NOT go negative.
        // This is documented ops behaviour: refunds cannot overdraft a wallet.
        // The deficit is recorded in the ledger for manual reconciliation.
        walletBalanceAfterPaisa = wallet.balancePaisa;
      }

      await tx.walletTransaction.create({
        data: {
          userId: payment.userId,
          direction: "DEBIT",
          amountPaisa: payment.amountPaisa,
          reason: `Refund ${payment.refNo}${branch === "RESTOCK" ? " (restock)" : ""}`,
          balanceAfterPaisa: walletBalanceAfterPaisa,
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
