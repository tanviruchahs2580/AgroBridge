import type { Prisma } from "@prisma/client";

/**
 * Payment-meta helpers shared by every path that reads or writes a Payment
 * row's `metaStr`: intent creation, the sandbox/live claim, the gateway
 * webhook, and the two void paths (cancel / supersede).
 *
 * They live beside `voidPendingIntents` — the lib layer the payment modules
 * already import — rather than inside a feature module, so the one rule that
 * matters has exactly one implementation: a client idempotency key rides inside
 * `metaStr` and must survive every status transition, because a client
 * retrying intent creation after a lost response still has to find THAT payment
 * once it is no longer PENDING.
 */

/** Parses a payment's stored metaStr, tolerating null/corrupt JSON. */
export function paymentMetaOf(metaStr: string | null): Record<string, unknown> {
  if (!metaStr) return {};
  try {
    const parsed = JSON.parse(metaStr) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Client idempotency key as stored in a payment's metaStr (null when absent). */
export function idempotencyKeyOfMeta(metaStr: string | null): string | null {
  const key = paymentMetaOf(metaStr).idempotencyKey;
  return typeof key === "string" ? key : null;
}

/**
 * Composes a payment's next metaStr from its CURRENT value, preserving the
 * client idempotency key when one is present. A plain
 * `JSON.stringify({ ...next })` silently destroys the key — which is exactly
 * how the webhook (F-02) and both void paths (F-23) turned a keyed retry into a
 * brand-new intent instead of a replay.
 */
export function mergePaymentMeta(before: string | null, next: Record<string, unknown>): string {
  const clientKey = idempotencyKeyOfMeta(before);
  return JSON.stringify(clientKey ? { ...next, idempotencyKey: clientKey } : next);
}

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
 * Rows are read first and each is updated through its own conditional claim,
 * because a single `updateMany` cannot merge per-row JSON: the only shape it
 * can write is one constant `metaStr`, which is what used to shred the client's
 * key (F-23). At most one PENDING row can exist per (user, purpose) thanks to
 * `Payment_user_purpose_pending_key`, so this is a one-row loop in practice;
 * a row settled between the read and its update simply fails the claim and is
 * not counted.
 *
 * Call this INSIDE the cancelling transaction, before the state transition, so
 * a failed transition rolls the void back with it.
 */
export async function voidPendingIntents(
  tx: Prisma.TransactionClient,
  params: { purposeType: "ORDER" | "BOOKING" | "MEMBERSHIP"; purposeId: string; userId: string; reason: string }
): Promise<number> {
  const pending = await tx.payment.findMany({
    where: {
      purposeType: params.purposeType,
      purposeId: params.purposeId,
      userId: params.userId,
      status: "PENDING",
    },
    select: { id: true, metaStr: true },
  });

  let voided = 0;
  for (const payment of pending) {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      // A terminal FAILED row that records why, so support and the reconcile
      // script can tell a cancelled intent from an expired one — merged over
      // the existing meta so the key survives for a keyed retry.
      data: { status: "FAILED", metaStr: mergePaymentMeta(payment.metaStr, { cancelledReason: params.reason }) },
    });
    voided += claimed.count;
  }
  return voided;
}
