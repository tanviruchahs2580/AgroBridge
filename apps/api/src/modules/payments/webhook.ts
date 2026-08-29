import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { badRequest } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import { paymentIntentsTotal } from "../../lib/metrics.js";
import { env } from "../../config/env.js";
import { sslcommerzSignature, applyPaymentSideEffects } from "./routes.js";

/**
 * SSLCommerz IPN/webhook endpoint â€” the ONLY path to success when a real
 * gateway is configured. Unauthenticated by design; every request must carry
 * a valid provider signature (verify_sign). Replay-safe: a webhook for an
 * already-succeeded payment responds idempotently without re-applying
 * side effects.
 */
export const paymentWebhookRouter = Router();

paymentWebhookRouter.post("/webhook/sslcommerz", async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const params = (req.body ?? {}) as Record<string, string>;
    if (!params || typeof params !== "object") throw badRequest("Invalid webhook payload");

    const storePassword = env.SSLCOMMERZ_STORE_PASSWORD;
    if (!storePassword) throw badRequest("Payment gateway not configured");

    const expected = sslcommerzSignature(params, storePassword);
    if (!params.verify_sign || expected !== params.verify_sign.toUpperCase()) {
      // Log minimal info; never echo payload internals on failure.
      return res.status(401).json({ ok: false, error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
    }

    const tranId = params.tran_id ?? "";
    const valId = params.val_id ?? "";
    const gwStatus = (params.status ?? "").toUpperCase();
    if (!["VALID", "VALIDATED"].includes(gwStatus)) {
      return ok(res, { received: true, processed: false, reason: `status_${gwStatus}` });
    }

    // tran_id convention: our Payment.refNo (set at gateway session creation).
    const payment = await prisma.payment.findFirst({ where: { refNo: tranId } });
    if (!payment) {
      return res.status(404).json({ ok: false, error: { code: "PAYMENT_NOT_FOUND", message: "Unknown transaction reference" } });
    }
    if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") {
      return ok(res, { received: true, processed: false, reason: "already_final" });
    }

    await prisma.$transaction(async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "SUCCEEDED", providerRef: valId || payment.providerRef, metaStr: JSON.stringify({ mode: "sslcommerz", valId, verified: true }) },
      });
      if (claimed.count !== 1) return; // lost race -> already final
      await applyPaymentSideEffects(tx as never, payment);
    }, { timeout: 15000, maxWait: 8000 });

    paymentIntentsTotal.inc({ purpose_type: payment.purposeType, status: "webhook_confirmed" });
    await audit({ action: "PAYMENT_WEBHOOK_CONFIRMED", entityType: "Payment", entityId: payment.id, meta: { tranId, valId } });
    await notify({
      userId: payment.userId,
      type: "PAYMENT",
      category: "CRITICAL",
      titleBn: `পেমেন্ট নিশ্চিত হয়েছে (${payment.refNo})`,
      titleEn: `Payment confirmed (${payment.refNo})`,
      bodyBn: "গেটওয়ে থেকে পেমেন্ট নিশ্চিতকরণ এসেছে।",
      bodyEn: "Payment confirmation received from the gateway.",
      refType: "PAYMENT",
      refId: payment.id,
    });

    // SSLCommerz expects a simple acknowledgement.
    ok(res, { received: true, processed: true });
  } catch (e) {
    next(e);
  }
});

