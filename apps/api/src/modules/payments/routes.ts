import { Router } from "express";
import type { Payment, Prisma } from "@prisma/client";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { notFound, unprocessable, forbidden, phoneNotVerified, conflict, paymentGatewayUnconfigured, paymentGatewayUnavailable } from "../../shared/errors/index.js";
import { ok, idempotencyKeyOf } from "../../middleware/context.js";
import { acceptIdempotencyKeyHeader } from "../../middleware/idempotency.js";
import { refNo } from "../../lib/money.js";
import { getActiveMembership } from "../../lib/membership.js";
import { notify } from "../../providers/notification/service.js";
import { audit } from "../../middleware/audit.js";
import { paymentIntentsTotal } from "../../lib/metrics.js";
import { logger } from "../../lib/logger.js";
import { env, isProd } from "../../config/env.js";
import { createRedisStore } from "../../lib/rateLimitRedis.js";
import { rateLimitHandler } from "../../middleware/rateLimitResponse.js";
import { getPaymentProvider } from "../../providers/payment/index.js";
import { actorRegionLimit, assertSubjectInRegion } from "../../lib/territory.js";
import { assertNotSelfDealing } from "../../lib/separationOfDuties.js";
import { getAuth } from "../../shared/auth-context.js";

export const paymentsRouter = Router();

/** Params contract for the /:id routes (AUD-V3 L-3: raw params were unvalidated). */
const idParams = z.object({ id: z.string().min(1).max(64) });
export const walletRouter = Router();
export const membershipRouter = Router();

paymentsRouter.use(requireAuth);

// Financial hot paths get stricter limits than the global one.
// Keyed by authenticated user so one busy user cannot exhaust another's quota.
// (Defined at module top: used by both paymentsRouter and walletRouter.)
const financialStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL, 60 * 60 * 1000, "financial") : undefined;
const financialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "unknown",
  store: financialStore,
  // Standardized 429 envelope: requestId + ok:false/error shape, with
  // this limiter's own message preserved.
  handler: rateLimitHandler,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many financial operations. Please slow down." } },
});

/** Mask a payout destination for storage/display (never store full account). */
function maskDestination(phone: string): string {
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

/** metaStr parsed defensively — absent/malformed JSON degrades to "no metadata". */
function parsedMeta(metaStr: string | null): Record<string, unknown> {
  if (!metaStr) return {};
  try {
    const parsed = JSON.parse(metaStr) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Client idempotency key as stored in a payment's metaStr JSON (null when absent). */
function idempotencyKeyOfMeta(metaStr: string | null): string | null {
  const key = parsedMeta(metaStr).idempotencyKey;
  return typeof key === "string" ? key : null;
}

/** Checkout URL stored at creation time, so a keyed replay resumes the same session. */
function metaRedirectUrl(metaStr: string | null): string | undefined {
  const url = parsedMeta(metaStr).redirectUrl;
  return typeof url === "string" ? url : undefined;
}

/** The prisma surface the keyed lookup needs — satisfied by the client and a tx client alike. */
type PaymentFinder = Pick<typeof prisma, "payment">;

/**
 * Keyed replay lookup: one `Idempotency-Key` = one payment for its lifetime
 * (the payments analogue of checkout's one key = one order). metaStr is the
 * key's only column, so a containment prefilter narrows the rows and the
 * parsed value confirms the exact match — a JSON substring can never be
 * mistaken for the key itself.
 */
async function findPaymentByClientKey(db: PaymentFinder, userId: string, key: string): Promise<Payment | null> {
  const fragment = `"idempotencyKey":${JSON.stringify(key)}`;
  const candidates = await db.payment.findMany({
    where: { userId, metaStr: { contains: fragment } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return candidates.find((p) => idempotencyKeyOfMeta(p.metaStr) === key) ?? null;
}

/**
 * Response envelope for a CREATED or REPLAYED intent — a replay must look
 * exactly like the response the original creation returned (same paymentId,
 * refNo, amount), so a retrying client cannot tell it apart from the first
 * success. `redirectUrl` comes from the stored metadata when present.
 */
function paymentIntentEnvelope(payment: Payment, redirectUrl?: string) {
  const provider = getPaymentProvider();
  return {
    paymentId: payment.id,
    refNo: payment.refNo,
    amountPaisa: payment.amountPaisa,
    providerMode: env.PAYMENT_PROVIDER,
    ...(redirectUrl ? { redirectUrl } : {}),
    messageBn: provider.mode === "sandbox" ? "স্যান্ডবক্স মোড — কোনো প্রকৃত অর্থ লেনদেন হবে না।" : undefined,
    messageEn: provider.mode === "sandbox" ? "Sandbox mode — no real money will move." : undefined,
  };
}

/**
 * Absolute URL of this API, used for gateway callbacks. Prefers the explicit
 * `API_PUBLIC_URL` (stable behind any proxy); otherwise derives it from the
 * request, honouring the configured trust-proxy so the scheme reflects the
 * edge that terminated TLS.
 */
function apiPublicBaseUrl(req: import("express").Request): string {
  if (env.API_PUBLIC_URL) return env.API_PUBLIC_URL.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

/**
 * Business side effects of a successful payment. Called exactly once per
 * payment because callers must first win the PENDING->SUCCEEDED claim.
 * Side effects themselves are conditional where possible (defense in depth):
 * each predicate re-asserts the target is still PAYABLE, so a payment that
 * settles against an object someone already cancelled or refunded cannot
 * resurrect it.
 *
 * When a side effect finds nothing payable the money is at the gateway while
 * the object is closed. That is not an error to swallow — it is the
 * reconciliation case, so it is audited with the payment reference and left for
 * support (the refund endpoint accepts a SUCCEEDED ORDER payment for exactly
 * this shape).
 */
export async function applyPaymentSideEffects(
  tx: Prisma.TransactionClient,
  payment: { purposeType: string; purposeId: string; userId: string; id?: string; refNo?: string },
) {
  if (payment.purposeType === "ORDER") {
    // CONFIRMED is part of the predicate, not decoration: cancellation sets
    // CANCELLED and returns the stock to the pool, so flipping a cancelled
    // order to PAID would leave the buyer's money captured against goods that
    // are no longer committed to them.
    const applied = await tx.order.updateMany({
      where: { id: payment.purposeId, status: "CONFIRMED", paymentStatus: "UNPAID" },
      data: { status: "PAID", paymentStatus: "PAID" },
    });
    if (applied.count !== 1) {
      await audit({
        actorId: null,
        action: "PAYMENT_NOT_PAYABLE",
        entityType: "Payment",
        entityId: payment.id ?? payment.purposeId,
        meta: {
          refNo: payment.refNo ?? null,
          purposeType: payment.purposeType,
          purposeId: payment.purposeId,
          reason: "order no longer CONFIRMED+UNPAID when the payment settled — captured money needs a refund decision",
        },
      });
    }
  } else if (payment.purposeType === "BOOKING") {
    const applied = await tx.booking.updateMany({
      where: { id: payment.purposeId, status: { in: ["REQUESTED", "ASSIGNED"] }, paymentStatus: "UNPAID" },
      data: { paymentStatus: "PAID" },
    });
    if (applied.count !== 1) {
      await audit({
        actorId: null,
        action: "PAYMENT_NOT_PAYABLE",
        entityType: "Payment",
        entityId: payment.id ?? payment.purposeId,
        meta: {
          refNo: payment.refNo ?? null,
          purposeType: payment.purposeType,
          purposeId: payment.purposeId,
          reason: "booking was cancelled or already settled when the payment settled — captured money needs a refund decision",
        },
      });
    }
  } else if (payment.purposeType === "MEMBERSHIP") {
    // Both reads go through the TRANSACTION client (AUD-V3): the outer
    // client read a different snapshot, so an expiry extension racing this
    // claim could compute "extend from" on a stale base even though the
    // writes correctly used tx.
    const plan = await tx.membershipPlan.findUnique({ where: { tier: payment.purposeId } });
    const durationDays = plan?.durationDays ?? 365;
    const profile = await tx.farmerProfile.findUnique({
      where: { userId: payment.userId },
      select: { membershipExpiresAt: true },
    });
    // Extend from existing expiry when still active, else from now.
    const base = profile?.membershipExpiresAt && profile.membershipExpiresAt > new Date() ? profile.membershipExpiresAt : new Date();
    const expiresAt = new Date(base.getTime() + durationDays * 86_400_000);
    await tx.farmerProfile.upsert({
      where: { userId: payment.userId },
      update: { membershipTier: payment.purposeId, membershipExpiresAt: expiresAt },
      create: { userId: payment.userId, membershipTier: payment.purposeId, membershipExpiresAt: expiresAt },
    });
  }
}

/**
 * Payment intent creation. With SSLCommerz configured the provider session is
 * created for real and the caller receives the hosted-checkout URL; with the
 * sandbox provider (development, or a production pilot that opted in via
 * ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION) the response says so explicitly.
 *
 * A production deployment that has no gateway refuses to hand back a payable
 * intent: simulate-and-succeed would mark orders PAID without collecting money.
 */
paymentsRouter.post(
  "/intent",
  financialLimiter,
  // Same header contract as checkout (ARC-10): a malformed key is a 400 and a
  // present key maps into the body, never silently ignored — an intent made
  // with a key the server dropped would turn a retry into a duplicate fee.
  acceptIdempotencyKeyHeader,
  validate({
    body: z.object({
      // PROCUREMENT is deliberately absent: payouts flow through the
      // procurement /payouts route; advertising it here just to refuse it
      // made the validation contract lie (AUD-V3 L-7).
      purposeType: z.enum(["ORDER", "BOOKING", "MEMBERSHIP"]),
      purposeId: z.string().min(5),
    }),
  }),
  async (req, res, next) => {
    try {
      const { purposeType, purposeId } = req.body as { purposeType: string; purposeId: string };
      const userId = getAuth(req).userId;
      const clientKey = idempotencyKeyOf(req);

      // Keyed replay fast path: this key already produced a payment (retry
      // after a lost response, duplicate submit) — return the ORIGINAL intent
      // with 200 before any supersede/creation side effect, mirroring
      // checkout's keyed order replay. Replay answers even when the deployment
      // would refuse a NEW intent: nothing is fabricated by returning a row
      // that already exists.
      if (clientKey) {
        const replay = await findPaymentByClientKey(prisma, userId, clientKey);
        if (replay) {
          ok(res, paymentIntentEnvelope(replay, metaRedirectUrl(replay.metaStr)), 200);
          return;
        }
      }

      if (isProd && env.PAYMENT_PROVIDER === "sandbox" && env.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION !== "1") {
        throw paymentGatewayUnconfigured();
      }

      let amountPaisa: number;
      if (purposeType === "ORDER") {
        const order = await prisma.order.findFirst({ where: { id: purposeId, userId, status: { in: ["CONFIRMED", "PENDING"] }, paymentStatus: "UNPAID" } });
        if (!order) throw notFound("Payable order");
        amountPaisa = order.totalPaisa;
      } else if (purposeType === "BOOKING") {
        const b = await prisma.booking.findFirst({ where: { id: purposeId, userId, paymentStatus: "UNPAID", status: { in: ["REQUESTED", "ASSIGNED"] } } });
        if (!b) throw notFound("Payable booking");
        amountPaisa = b.estimatedPricePaisa;
      } else {
        const plan = await prisma.membershipPlan.findUnique({ where: { tier: purposeId } });
        if (!plan || !plan.isActive) throw notFound("Membership plan");
        amountPaisa = plan.pricePaisa;
      }

      // One reference number is generated up front and used for BOTH the
      // gateway session (tran_id) and our Payment row, so the webhook can match
      // the two without a second lookup key.
      const paymentRefNo = refNo("PAY");

      // Ask the configured gateway for a session BEFORE persisting the payment,
      // so a gateway outage leaves no orphaned PENDING row behind.
      const provider = getPaymentProvider();
      const customerPhone = (
        await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } })
      )?.phone ?? "";
      let gatewayRedirectUrl: string | undefined;
      let gatewayRef: string;
      let gatewayMeta: Record<string, unknown> = { mode: env.PAYMENT_PROVIDER };

      if (provider.mode === "live") {
        const returnBaseUrl = apiPublicBaseUrl(req);
        let intent: Awaited<ReturnType<typeof provider.createPayment>>;
        try {
          intent = await provider.createPayment({ amountPaisa, refNo: paymentRefNo, customerPhone, returnBaseUrl });
        } catch (e) {
          throw paymentGatewayUnavailable({ reason: (e as Error).message });
        }
        if (!intent.redirectUrl) throw paymentGatewayUnavailable({ reason: "gateway returned no checkout URL" });
        gatewayRef = intent.providerRef;
        gatewayRedirectUrl = intent.redirectUrl;
        // The checkout URL is stored alongside the gateway metadata so a
        // keyed replay can hand the client back the SAME session.
        gatewayMeta = { ...gatewayMeta, ...(intent.meta ?? {}), redirectUrl: intent.redirectUrl };
      } else {
        gatewayRef = `SBX-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }

      const { payment, replayed } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Re-check inside the transaction: two same-key requests that both
        // passed the fast path must still produce exactly ONE payment — the
        // loser replays the winner's row instead of superseding it. (In a
        // live-gateway race the loser's just-created gateway session is
        // orphaned; it holds no payment row, so a webhook for it can never
        // settle anything.)
        if (clientKey) {
          const existing = await findPaymentByClientKey(tx, userId, clientKey);
          if (existing) return { payment: existing, replayed: true };
        }

        // Cancel any stale PENDING intents for the same purpose so exactly one
        // live intent exists at a time (prevents double-confirm double-spend).
        // Scoped to THIS user: purposeId is a shared business key (e.g. the
        // membership tier), so an unscoped supersede would cancel other users'
        // in-flight checkouts.
        await tx.payment.updateMany({
          where: { purposeType, purposeId, userId, status: "PENDING" },
          data: { status: "FAILED", metaStr: JSON.stringify({ cancelledReason: "superseded_by_new_intent" }) },
        });
        const created = await tx.payment.create({
          data: {
            refNo: paymentRefNo,
            userId,
            purposeType,
            purposeId,
            amountPaisa,
            method: "MOBILE_WALLET",
            providerRef: gatewayRef,
            metaStr: JSON.stringify(clientKey ? { ...gatewayMeta, idempotencyKey: clientKey } : gatewayMeta),
            // Correlation for support/audit joins (X-Request-Id of this request).
            requestId: req.requestId,
          },
        });
        return { payment: created, replayed: false };
      });
      if (!replayed) paymentIntentsTotal.inc({ purpose_type: purposeType, status: "created" });
      // Intent creation is a security-adjacent money event: without a trail row,
      // a stale-intent supersede (right above) is invisible to the audit log.
      // Replays are answered, not re-logged — one intent, one trail row.
      if (!replayed) {
        await audit({
          actorId: userId,
          action: "PAYMENT_INTENT_CREATED",
          entityType: "Payment",
          entityId: payment.id,
          meta: { purposeType, purposeId, amountPaisa, providerMode: env.PAYMENT_PROVIDER },
        });
      }

      ok(res, paymentIntentEnvelope(payment, metaRedirectUrl(payment.metaStr) ?? gatewayRedirectUrl), replayed ? 200 : 201);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * Claims a PENDING payment and applies its side effects exactly once. Both the
 * sandbox confirm path and the live gateway reconciliation path funnel through
 * here so the idempotency guarantee lives in one place.
 * Returns false when the payment was not claimable (already final, superseded).
 */
export async function claimAndApplyPayment(
  payment: { id: string; userId: string; refNo: string; purposeType: string; purposeId: string },
  meta: Record<string, unknown>
): Promise<boolean> {
  let claimed = false;
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // A client idempotency key (when one was supplied) rides in metaStr and
    // must survive confirmation: a client retrying intent creation after a
    // lost response still has to find THIS payment once it is no longer
    // PENDING, and metaStr is the key's only column.
    const before = await tx.payment.findUnique({ where: { id: payment.id }, select: { metaStr: true } });
    const clientKey = idempotencyKeyOfMeta(before?.metaStr ?? null);
    const res = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "SUCCEEDED", metaStr: JSON.stringify(clientKey ? { ...meta, idempotencyKey: clientKey } : meta) },
    });
    if (res.count !== 1) return;
    claimed = true;
    await applyPaymentSideEffects(tx, payment);
  }, { timeout: 15000, maxWait: 8000 });

  if (claimed) {
    await audit({ actorId: payment.userId, action: "PAYMENT_SUCCEEDED", entityType: "Payment", entityId: payment.id, meta });
    await notify({
      userId: payment.userId,
      type: "PAYMENT",
      category: "CRITICAL",
      titleBn: `পেমেন্ট সফল (${payment.refNo})`,
      titleEn: `Payment successful (${payment.refNo})`,
      bodyBn: meta.sandbox ? "স্যান্ডবক্স লেনদেন।" : "পেমেন্ট নিশ্চিত হয়েছে।",
      bodyEn: meta.sandbox ? "Sandbox transaction." : "Payment confirmed.",
      refType: "PAYMENT",
      refId: payment.id,
    });
    paymentIntentsTotal.inc({ purpose_type: payment.purposeType, status: "confirmed" });
  }
  return claimed;
}

/**
 * Reconciliation rule shared by every live-gateway confirmation path
 * (`GET /:id/status`, gateway return): the webhook's own standard — a verdict
 * from the gateway proves the SESSION succeeded, not that it belongs to THIS
 * charge — applied to the amount before any PENDING→SUCCEEDED claim. A
 * mismatched, missing, or non-finite amount leaves the payment PENDING (the
 * signed webhook remains the final authority) and is audited so a partial
 * payment can be reconciled by an operator instead of silently dropping.
 */
export async function reconcileLiveVerdict(
  payment: { id: string; userId: string; refNo: string; purposeType: string; purposeId: string; amountPaisa: number },
  verdict: { status: "SUCCEEDED" | "FAILED" | "PENDING"; amountPaisa?: number }
): Promise<{ reconciled: boolean; reason?: "amount_mismatch" }> {
  if (verdict.status === "FAILED") {
    await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
    return { reconciled: false };
  }
  if (verdict.status !== "SUCCEEDED") return { reconciled: false };

  if (verdict.amountPaisa !== payment.amountPaisa) {
    logger.warn(
      { paymentId: payment.id, refNo: payment.refNo, expectedPaisa: payment.amountPaisa, verdictPaisa: verdict.amountPaisa ?? null },
      "live-gateway reconciliation amount mismatch — payment left PENDING"
    );
    await audit({
      actorId: payment.userId,
      action: "PAYMENT_RECONCILE_AMOUNT_MISMATCH",
      entityType: "Payment",
      entityId: payment.id,
      meta: { expectedPaisa: payment.amountPaisa, verdictPaisa: verdict.amountPaisa ?? null },
    });
    return { reconciled: false, reason: "amount_mismatch" };
  }

  const claimed = await claimAndApplyPayment(payment, {
    mode: env.PAYMENT_PROVIDER,
    verified: true,
    amountPaisa: verdict.amountPaisa,
  });
  return claimed ? { reconciled: true } : { reconciled: false };
}

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

/**
 * Sandbox confirm: simulates the gateway return path. Only available when the
 * sandbox provider is actually in use, and — in production — only for a
 * deployment that explicitly opted in (ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION).
 * Live gateways move money exclusively through the verified webhook.
 * Idempotent under concurrency: only the first PENDING->SUCCEEDED claim wins.
 */
paymentsRouter.post("/:id/confirm", validate({ params: idParams }), async (req, res, next) => {
  try {
    if (env.PAYMENT_PROVIDER !== "sandbox") {
      throw forbidden("Direct confirmation is disabled; complete payment through the gateway");
    }
    if (isProd && env.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION !== "1") {
      throw paymentGatewayUnconfigured();
    }
    const payment = await prisma.payment.findFirst({ where: { id: req.params.id, userId: getAuth(req).userId } });
    if (!payment) throw notFound("Payment");
    if (payment.status !== "PENDING") throw conflict(`Payment already ${payment.status}`);

    const claimed = await claimAndApplyPayment(payment, { mode: "sandbox", sandbox: true });
    if (!claimed) throw conflict(`Payment already ${payment.status}`);
    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    ok(res, updated);
  } catch (e) {
    next(e);
  }
});

/**
 * Reconciles a payment with the gateway. Used by the client after returning
 * from hosted checkout, so a confirmation does not depend solely on the
 * webhook reaching us. Verification is idempotent and only a SUCCEEDED result
 * from the provider can move a payment forward.
 */
paymentsRouter.get("/:id/status", validate({ params: idParams }), async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({ where: { id: req.params.id, userId: getAuth(req).userId } });
    if (!payment) throw notFound("Payment");
    if (payment.status !== "PENDING") {
      ok(res, { status: payment.status, reconciled: false });
      return;
    }

    const provider = getPaymentProvider();
    if (provider.mode !== "live") {
      ok(res, { status: payment.status, reconciled: false, providerMode: env.PAYMENT_PROVIDER });
      return;
    }

    let verdict: Awaited<ReturnType<typeof provider.verifyPayment>>;
    try {
      verdict = await provider.verifyPayment(payment.providerRef ?? payment.refNo, paymentMetaOf(payment.metaStr));
    } catch (e) {
      throw paymentGatewayUnavailable({ reason: (e as Error).message });
    }

    // SUCCEEDED verdicts still face the amount cross-check the signed webhook
    // enforces (reconcileLiveVerdict) before any PENDING→SUCCEEDED claim.
    const { reconciled, reason } = await reconcileLiveVerdict(payment, verdict);
    const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    ok(res, { status: final.status, reconciled, reason, providerMode: env.PAYMENT_PROVIDER, providerVerdict: verdict.status });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.get("/", async (req, res, next) => {
  try {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN"].includes(getAuth(req).role);
    // X-Total-Count: admin/finance see ALL payments while a user
    // sees their own; either way the body is a capped slice (100) and the
    // header carries the scope's true total so truncation is visible.
    const where = isPrivileged ? {} : { userId: getAuth(req).userId };
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.payment.count({ where }),
    ]);
    res.setHeader("X-Total-Count", String(total));
    ok(res, payments);
  } catch (e) {
    next(e);
  }
});

// ---------------- Refunds (platform-initiated, orders only in v1) ----------------

/**
 * `gatewayRef` is the reference the LIVE gateway returned when the operator
 * issued the refund in its dashboard. This endpoint never calls the gateway —
 * with a live provider it records the already-issued refund bookkeeping-style,
 * and refuses without the operator-supplied reference so a made-up refundRef
 * can never masquerade as a real gateway refund.
 */
const refundSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  gatewayRef: z.string().min(4).max(64).optional(),
});

paymentsRouter.post(
  "/:id/refund",
  requirePermission("payments:refund"),
  validate({ params: idParams, body: refundSchema }),
  async (req, res, next) => {
    try {
      // Same provider resolution as /intent (getPaymentProvider). Sandbox: this
      // endpoint moves simulated money (a wallet-ledger entry). Live: the real
      // refund must already have been issued in the gateway dashboard and the
      // operator supplies the gateway's refund reference — otherwise we would
      // report REFUNDED while the buyer's money is still with the gateway.
      const provider = getPaymentProvider();
      const liveGateway = provider.mode !== "sandbox";
      const { reason, gatewayRef } = req.body as z.infer<typeof refundSchema>;
      if (liveGateway && !gatewayRef) {
        throw unprocessable(
          "Live-gateway refunds are issued in the gateway dashboard first; then record the completed refund here with the gateway's refund reference (gatewayRef)"
        );
      }
      if (!liveGateway && isProd && env.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION !== "1") {
        throw paymentGatewayUnconfigured();
      }

      const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!payment) throw notFound("Payment");
      if (payment.purposeType === "MEMBERSHIP") {
        throw unprocessable("Membership purchases are non-refundable while active (see Terms)");
      }
      if (payment.purposeType !== "ORDER") {
        throw unprocessable(`Refunds for ${payment.purposeType} are not supported yet`);
      }

      // Narrowed here, outside the transaction closure: TypeScript does not
      // carry the `!gatewayRef` guard above into the callback.
      const liveRefundRef: string | undefined = liveGateway ? gatewayRef : undefined;

      await prisma.$transaction(async (tx) => {
        // Atomic claim: only one refund can transition SUCCEEDED -> REFUNDED.
        // Live mode stores the operator-supplied gateway reference verbatim;
        // sandbox generates its own RFND- ref (unchanged).
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: "SUCCEEDED" },
          data: { status: "REFUNDED", refundedAt: new Date(), refundRef: liveRefundRef ?? refNo("RFND") },
        });
        if (claimed.count !== 1) throw conflict(`Payment already ${payment.status}`);

        await tx.order.updateMany({
          where: { id: payment.purposeId, paymentStatus: "PAID" },
          data: { status: "REFUNDED", paymentStatus: "REFUNDED" },
        });

        // Compensating ledger entry. Balance may go negative on deliberate
        // refunds exceeding wallet balance â€” documented ops behaviour.
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
            reason: `Refund ${payment.refNo}`,
            balanceAfterPaisa: wallet.balancePaisa,
            refType: "PAYMENT",
            refId: payment.id,
          },
        });
      }, { timeout: 15000, maxWait: 8000 });

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      await audit({
        actorId: getAuth(req).userId,
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        meta: { reason, ...(liveGateway ? { gatewayRef, gatewayRefund: true } : {}) },
      });
      await notify({
        userId: payment.userId,
        type: "PAYMENT",
        category: "CRITICAL",
        // Honest copy, mode-specific: sandbox is a wallet adjustment (not
        // gateway money); live is a record of a refund the operator already
        // issued in the gateway dashboard (the wallet entry documents it).
        ...(liveGateway
          ? {
              titleBn: "রিফান্ড রেকর্ড হয়েছে (গেটওয়ে)",
              titleEn: "Refund recorded (gateway)",
              bodyBn: `গেটওয়ে রেফারেন্স ${gatewayRef} দিয়ে রিফান্ড রেকর্ড করা হয়েছে; প্ল্যাটফর্ম ওয়ালেটের ডেবিট এন্ট্রি এটির নথি।`,
              bodyEn: `Refund recorded with gateway reference ${gatewayRef}; the platform-wallet debit entry documents it.`,
            }
          : {
              titleBn: "রিফান্ড রেকর্ড (স্যান্ডবক্স)",
              titleEn: "Refund recorded (sandbox)",
              bodyBn: "স্যান্ডবক্স রিফান্ড — প্ল্যাটফর্ম ওয়ালেট থেকে সমপরিমাণ অর্থ ডেবিট এন্ট্রি হয়েছে; প্রকৃত গেটওয়ে অর্থ ফেরত নয়।",
              bodyEn: "Sandbox refund — the amount was recorded as a platform-wallet debit entry; no real gateway money was returned.",
            }),
        refType: "PAYMENT",
        refId: payment.id,
      });
      ok(res, updated);
    } catch (e) {
      next(e);
    }
  }
);

// Procurement payout to farmer wallet
const payoutSchema = z.object({ poId: z.string().min(5) });

paymentsRouter.post(
  "/payouts",
  requirePermission("procurement:pay"),
  validate({ body: payoutSchema }),
  async (req, res, next) => {
    try {
      const po = await prisma.procurementOrder.findUnique({ where: { id: (req.body as { poId: string }).poId }, include: { user: { select: { phoneVerified: true } } } });
      if (!po) throw notFound("Procurement order");
      // Payouts are money leaving the platform: a territory-scoped procurement
      // manager may only pay farmers in their own region.
      await assertSubjectInRegion(
        await actorRegionLimit(getAuth(req).userId, getAuth(req).role),
        po.userId,
        "This procurement order"
      );
      // …and paying out your own offer is self-dealing. `procurement:pay` and
      // `procurement:review` can be held by the same role, so without this one
      // account could approve its own self-graded offer and credit itself.
      assertNotSelfDealing(getAuth(req).userId, po.userId, getAuth(req).role, "This procurement offer");
      if (!po.user.phoneVerified && isProd) throw phoneNotVerified();
      if (po.status !== "COLLECTED") throw unprocessable(`Cannot pay out PO in status ${po.status}`);
      if (po.netPayablePaisa <= 0) throw unprocessable("Nothing payable");

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Atomic claim: only the first COLLECTED -> PAID transition wins; concurrent
        // payouts lose the race and abort (prevents double-crediting under PostgreSQL).
        const claimed = await tx.procurementOrder.updateMany({
          where: { id: po.id, status: "COLLECTED" },
          data: { status: "PAID" },
        });
        if (claimed.count !== 1) throw conflict("Procurement order already paid");

        const payment = await tx.payment.create({
          data: {
            refNo: refNo("POUT"),
            userId: po.userId,
            purposeType: "PROCUREMENT",
            purposeId: po.id,
            amountPaisa: po.netPayablePaisa,
            method: "WALLET_CREDIT",
            status: "SUCCEEDED",
            requestId: req.requestId,
          },
        });

        // Atomic increment; ledger row records the resulting balance for auditability.
        const updatedWallet = await tx.wallet.upsert({
          where: { userId: po.userId },
          update: { balancePaisa: { increment: po.netPayablePaisa } },
          create: { userId: po.userId, balancePaisa: po.netPayablePaisa },
        });
        await tx.walletTransaction.create({
          data: {
            userId: po.userId,
            direction: "CREDIT",
            amountPaisa: po.netPayablePaisa,
            reason: `Procurement ${po.poNo}`,
            balanceAfterPaisa: updatedWallet.balancePaisa,
            refType: "PROCUREMENT_ORDER",
            refId: po.id,
          },
        });

        return { payment, newBalance: updatedWallet.balancePaisa };
      }, { timeout: 15000, maxWait: 8000 });

      await notify({
        userId: po.userId,
        type: "PAYMENT",
        category: "CRITICAL",
        titleBn: `ফসলের মূল্য পরিশোধ (${po.poNo})`,
        titleEn: `Crop payment credited (${po.poNo})`,
        bodyEn: `৳${(po.netPayablePaisa / 100).toFixed(2)} credited to your AgroBridge wallet.`,
        refType: "PAYMENT",
        refId: result.payment.id,
      });

      ok(res, { payment: result.payment, walletBalancePaisa: result.newBalance }, 201);
    } catch (e) {
      next(e);
    }
  }
);

// ---------------- Wallet ----------------
walletRouter.use(requireAuth);

walletRouter.get("/", async (req, res, next) => {
  try {
    // X-Total-Count: the ledger body is a capped slice (50); the
    // header is the same user scope's true count so the UI can say "showing
    // 50 of N" without a second query shape.
    //
    // A read must not write (AUD-V3): the old upsert created a wallet row on
    // every first GET. Registration creates the wallet; a missing row here
    // means zero ever moved, so the balance is derived instead of inserted.
    const txWhere = { userId: getAuth(req).userId };
    const [wallet, transactions, txTotal] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId: getAuth(req).userId } }),
      prisma.walletTransaction.findMany({ where: txWhere, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.walletTransaction.count({ where: txWhere }),
    ]);
    res.setHeader("X-Total-Count", String(txTotal));
    ok(res, { balancePaisa: wallet?.balancePaisa ?? 0, transactions });
  } catch (e) {
    next(e);
  }
});

/**
 * Re-exported for existing importers (timezone-boundaries tests): the
 * implementation moved to shared/utils so the AI budget window can use the
 * same Dhaka business calendar without importing a payments route module.
 */
import { dhakaMonthStart } from "../../shared/utils/dhakaMonth.js";
export { dhakaMonthStart };

/** Financial month-in/out + pending holds + membership snapshot. */
walletRouter.get("/summary", async (req, res, next) => {
  try {
    const startOfMonth = dhakaMonthStart();

    const [credits, debits, held, membership] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: { userId: getAuth(req).userId, direction: "CREDIT", createdAt: { gte: startOfMonth } },
        _sum: { amountPaisa: true },
      }),
      prisma.walletTransaction.aggregate({
        where: { userId: getAuth(req).userId, direction: "DEBIT", createdAt: { gte: startOfMonth } },
        _sum: { amountPaisa: true },
      }),
      // heldPaisa is maintained transactionally under the wallet row lock at
      // request/approve/reject time; it is the source of truth for in-flight
      // withdrawal holds (a cross-check against the Withdrawal table lives in
      // scripts/reconcile-wallet.mjs).
      prisma.wallet.findUnique({ where: { userId: getAuth(req).userId }, select: { heldPaisa: true } }),
      getActiveMembership(getAuth(req).userId),
    ]);

    ok(res, {
      monthCreditsPaisa: credits._sum.amountPaisa ?? 0,
      monthDebitsPaisa: debits._sum.amountPaisa ?? 0,
      pendingWithdrawalsPaisa: held?.heldPaisa ?? 0,
      membership,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------- Withdrawals ----------------

const MIN_WITHDRAWAL_PAISA = 10_000; // ৳100

const withdrawalSchema = z.object({
  amountPaisa: z.number().int().min(MIN_WITHDRAWAL_PAISA),
  channel: z.enum(["BKASH", "NAGAD", "BANK"]).default("BKASH"),
});

walletRouter.post("/withdrawals", financialLimiter, validate({ body: withdrawalSchema }), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: getAuth(req).userId } });
    if (!user) throw notFound("User");
    if (!user.phoneVerified && isProd) throw phoneNotVerified();

    const { amountPaisa, channel } = req.body as { amountPaisa: number; channel: string };

    const withdrawal = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Serialize all hold maintenance behind the wallet row's write lock:
      // the no-op increment UPDATE locks the row (PG) / defers the next writer
      // (SQLite) until this transaction commits. Re-reading AFTER the lock is
      // what closes the previous race where two parallel requests both passed
      // the aggregate availability check with the same pre-lock snapshot.
      await tx.wallet.upsert({
        where: { userId: getAuth(req).userId },
        update: { heldPaisa: { increment: 0 } },
        create: { userId: getAuth(req).userId },
      });
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: getAuth(req).userId } });
      const available = wallet.balancePaisa - wallet.heldPaisa;
      if (amountPaisa > available) {
        throw unprocessable("Insufficient available balance (pending withdrawals are held)");
      }
      await tx.wallet.update({
        where: { userId: getAuth(req).userId },
        data: { heldPaisa: { increment: amountPaisa } },
      });
      return tx.withdrawal.create({
        data: {
          refNo: refNo("WDL"),
          userId: getAuth(req).userId,
          amountPaisa,
          channel,
          destination: maskDestination(user.phone),
        },
      });
    }, { timeout: 15000, maxWait: 8000 });

    await audit({ actorId: getAuth(req).userId, action: "WITHDRAWAL_REQUESTED", entityType: "Withdrawal", entityId: withdrawal.id, meta: { amountPaisa } });
    ok(res, withdrawal, 201);
  } catch (e) {
    next(e);
  }
});

walletRouter.get("/withdrawals", async (req, res, next) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: getAuth(req).userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    ok(res, withdrawals);
  } catch (e) {
    next(e);
  }
});

// ---------------- Membership ----------------
membershipRouter.get("/plans", async (_req, res, next) => {
  try {
    const plans = await prisma.membershipPlan.findMany({ where: { isActive: true }, orderBy: { pricePaisa: "asc" } });
    ok(
      res,
      plans.map((p) => ({ ...p, benefits: JSON.parse(p.benefitsStr ?? "[]") as string[] }))
    );
  } catch (e) {
    next(e);
  }
});

/**
 * SSLCommerz IPN signature validation (documented algorithm):
 * sort all params except verify_sign/verify_key alphabetically, concatenate
 * STORE_PASSWORD + k1=v1 + k2=v2... with no separators, MD5 uppercase.
 */
export function sslcommerzSignature(params: Record<string, string>, storePassword: string): string {
  const concat = Object.keys(params)
    .filter((k) => k !== "verify_sign" && k !== "verify_key")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  return createHash("md5").update(storePassword + concat).digest("hex").toUpperCase();
}
