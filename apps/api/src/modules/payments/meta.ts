import type { Prisma } from "@prisma/client";
import { mergePaymentMeta } from "../../lib/pendingIntents.js";

/**
 * Payment-claim helpers shared by every path that settles a PENDING payment:
 * the sandbox confirm, the live-gateway `GET /:id/status` reconciliation, and
 * the signed SSLCommerz webhook. One implementation so no path can forget
 * either half of the settlement contract.
 */

/**
 * Claims a PENDING payment for a final SUCCEEDED status exactly once.
 *
 * Two things happen in one conditional update, so a caller cannot do one
 * without the other:
 *  - the `status: "PENDING"` predicate is the idempotency gate: `true` means
 *    THIS caller won the claim; a lost claim means another settlement path
 *    (webhook, sandbox confirm, reconciliation) already applied it, and the
 *    caller must not apply side effects again;
 *  - the final `metaStr` is composed from the row's CURRENT value, so a client
 *    idempotency key survives settlement — a client retrying intent creation
 *    after a lost response must still find this payment once it is no longer
 *    PENDING (F-02: the webhook used to overwrite metaStr wholesale and destroy
 *    the key, turning the retry into a second payable intent).
 */
export async function claimPendingPayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  meta: Record<string, unknown>,
): Promise<boolean> {
  const before = await tx.payment.findUnique({ where: { id: paymentId }, select: { metaStr: true } });
  const claimed = await tx.payment.updateMany({
    where: { id: paymentId, status: "PENDING" },
    data: { status: "SUCCEEDED", metaStr: mergePaymentMeta(before?.metaStr ?? null, meta) },
  });
  return claimed.count === 1;
}
