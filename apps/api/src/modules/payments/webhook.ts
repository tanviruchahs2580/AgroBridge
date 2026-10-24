import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { badRequest } from "../../shared/errors/index.js";
import { ok } from "../../middleware/context.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import { paymentIntentsTotal } from "../../lib/metrics.js";
import { logger } from "../../lib/logger.js";
import { env, primaryWebOrigin } from "../../config/env.js";
import { sslcommerzSignature, applyPaymentSideEffects, reconcileLiveVerdict, paymentMetaOf } from "./routes.js";
import { getPaymentProvider } from "../../providers/payment/index.js";

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

    // Constant-time comparison (both sides are 32-char MD5 hex; a plain !==
    // would leak a timing oracle over the digest,).
    const expected = sslcommerzSignature(params, storePassword);
    const provided = (params.verify_sign ?? "").toUpperCase();
    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(provided, "utf8");
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
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

    // Gateway amount verification: a valid signature proves the IPN came from
    // the gateway, not that it belongs to THIS charge. SSLCommerz sends
    // `amount` in BDT (decimals allowed) and `currency`. A mismatch (or a
    // missing/non-numeric amount, which no real IPN has) is refused and the
    // payment deliberately stays PENDING for reconciliation — never confirmed.
    const amountRaw = params.amount;
    const gatewayAmountPaisa = amountRaw != null && amountRaw !== "" ? Math.round(Number(amountRaw) * 100) : NaN;
    if (!Number.isFinite(gatewayAmountPaisa) || gatewayAmountPaisa !== payment.amountPaisa) {
      logger.warn(
        { tranId, paymentId: payment.id, expectedPaisa: payment.amountPaisa, gatewayAmount: amountRaw ?? null },
        "SSLCommerz webhook amount mismatch — payment left PENDING"
      );
      throw badRequest("Webhook amount does not match the payment");
    }
    if (params.currency && params.currency.toUpperCase() !== "BDT") {
      logger.warn({ tranId, paymentId: payment.id, currency: params.currency }, "SSLCommerz webhook currency mismatch — payment left PENDING");
      throw badRequest("Webhook currency is not BDT");
    }

    // The PENDING->SUCCEEDED claim is the idempotency gate: exactly one
    // webhook invocation applies the side effects. A lost claim means another
    // webhook won the race, or the intent was superseded (new intent FAILED
    // this one) despite the gateway collecting money — that case must NOT be
    // answered with processed:true, it is a reconciliation case.
    let processed = false;
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        // providerRef stays the merchant tran_id (stable across gateway
        // session keys); the gateway-side val_id lives in metaStr.
        data: { status: "SUCCEEDED", metaStr: JSON.stringify({ mode: "sslcommerz", valId, verified: true }) },
      });
      if (claimed.count !== 1) return; // lost race / superseded
      processed = true;
      await applyPaymentSideEffects(tx, payment);
    }, { timeout: 15000, maxWait: 8000 });

    if (!processed) {
      return ok(res, { received: true, processed: false, reason: "not_claimable" });
    }

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

/**
 * Hosted-checkout return. The gateway posts the buyer's browser here after
 * payment, so this route is deliberately unauthenticated and trusts NOTHING in
 * the request: the outcome path segment and any posted fields only decide where
 * the browser is sent next. Whether money actually moved is decided by asking
 * the provider (the signed webhook remains the primary path) — this endpoint
 * exists so a buyer is never stranded on a gateway page when an IPN is delayed.
 */
paymentWebhookRouter.all("/gateway/return/:outcome", async (req, res, next) => {
  try {
    const requested = req.params.outcome ?? "fail";
    const outcome = ["success", "fail", "cancel"].includes(requested) ? requested : "fail";
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Only the string forms count: a non-string body parameter must not
    // stringify to "[object Object]" and be treated as a transaction reference.
    const rawRef = body.tran_id ?? req.query.tran_id ?? req.query.ref;
    const refFromRequest = typeof rawRef === "string" ? rawRef : "";
    const payment = refFromRequest ? await prisma.payment.findFirst({ where: { refNo: refFromRequest } }) : null;

    if (payment && payment.status === "PENDING" && outcome === "success") {
      const provider = getPaymentProvider();
      if (provider.mode === "live") {
        try {
          const verdict = await provider.verifyPayment(payment.providerRef ?? payment.refNo, paymentMetaOf(payment.metaStr));
          // Same amount cross-check the signed webhook enforces, via the
          // shared reconciliation rule (reconcileLiveVerdict).
          await reconcileLiveVerdict(payment, verdict);
        } catch {
          // Stay PENDING: the webhook or a later status poll settles it.
        }
      }
    }

    // Send the buyer back to exactly one origin: WEB_ORIGIN is an allow-list
    // (site + Capacitor origin), and feeding the whole list to URL builds a
    // malformed location.
    const target = new URL("/orders", primaryWebOrigin);
    target.searchParams.set("payment", outcome);
    if (payment) target.searchParams.set("ref", payment.refNo);
    res.redirect(303, target.toString());
  } catch (e) {
    next(e);
  }
});

