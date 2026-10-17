import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { notFound, unprocessable, badRequest, forbidden, phoneNotVerified, conflict, paymentGatewayUnconfigured, paymentGatewayUnavailable } from "../../shared/errors/index.js";
import { ok } from "../../middleware/context.js";
import { refNo } from "../../lib/money.js";
import { getActiveMembership } from "../../lib/membership.js";
import { notify } from "../../providers/notification/service.js";
import { audit } from "../../middleware/audit.js";
import { paymentIntentsTotal } from "../../lib/metrics.js";
import { env, isProd } from "../../config/env.js";
import { createRedisStore } from "../../lib/rateLimitRedis.js";
import { getPaymentProvider } from "../../providers/payment/index.js";
import { actorRegionLimit, assertSubjectInRegion } from "../../lib/territory.js";

export const paymentsRouter = Router();
export const walletRouter = Router();
export const membershipRouter = Router();

paymentsRouter.use(requireAuth);

// Financial hot paths get stricter limits than the global one.
// Keyed by authenticated user so one busy user cannot exhaust another's quota.
// (Defined at module top: used by both paymentsRouter and walletRouter.)
const financialStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL, 60 * 60 * 1000) : undefined;
const financialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "unknown",
  store: financialStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many financial operations. Please slow down." } },
});

/** Mask a payout destination for storage/display (never store full account). */
function maskDestination(phone: string): string {
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
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
 * Side effects themselves are conditional where possible (defense in depth).
 */
export async function applyPaymentSideEffects(
  tx: Prisma.TransactionClient,
  payment: { purposeType: string; purposeId: string; userId: string },
) {
  if (payment.purposeType === "ORDER") {
    await tx.order.updateMany({
      where: { id: payment.purposeId, paymentStatus: "UNPAID" },
      data: { status: "PAID", paymentStatus: "PAID" },
    });
  } else if (payment.purposeType === "BOOKING") {
    await tx.booking.updateMany({
      where: { id: payment.purposeId, paymentStatus: "UNPAID" },
      data: { paymentStatus: "PAID" },
    });
  } else if (payment.purposeType === "MEMBERSHIP") {
    const plan = await prisma.membershipPlan.findUnique({ where: { tier: payment.purposeId } });
    const durationDays = plan?.durationDays ?? 365;
    const current = await getActiveMembership(payment.userId);
    // Extend from existing expiry when still active, else from now.
    const base = current.expiresAt && current.expiresAt > new Date() ? current.expiresAt : new Date();
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
  validate({
    body: z.object({
      purposeType: z.enum(["ORDER", "BOOKING", "PROCUREMENT", "MEMBERSHIP"]),
      purposeId: z.string().min(5),
    }),
  }),
  async (req, res, next) => {
    try {
      const { purposeType, purposeId } = req.body as { purposeType: string; purposeId: string };
      if (isProd && env.PAYMENT_PROVIDER === "sandbox" && env.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION !== "1") {
        throw paymentGatewayUnconfigured();
      }

      let amountPaisa: number;
      const userId = req.auth!.userId;
      if (purposeType === "ORDER") {
        const order = await prisma.order.findFirst({ where: { id: purposeId, userId, status: { in: ["CONFIRMED", "PENDING"] }, paymentStatus: "UNPAID" } });
        if (!order) throw notFound("Payable order");
        amountPaisa = order.totalPaisa;
      } else if (purposeType === "BOOKING") {
        const b = await prisma.booking.findFirst({ where: { id: purposeId, userId, paymentStatus: "UNPAID", status: { in: ["REQUESTED", "ASSIGNED"] } } });
        if (!b) throw notFound("Payable booking");
        amountPaisa = b.estimatedPricePaisa;
      } else if (purposeType === "PROCUREMENT") {
        // Procurement pays OUT to farmer via wallet credit on COLLECTED -> handled by payout route instead.
        throw badRequest("Procurement payouts are processed via /payouts by procurement managers");
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
        gatewayMeta = { ...gatewayMeta, ...(intent.meta ?? {}) };
      } else {
        gatewayRef = `SBX-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }

      // Cancel any stale PENDING intents for the same purpose so exactly one
      // live intent exists at a time (prevents double-confirm double-spend).
      // Scoped to THIS user: purposeId is a shared business key (e.g. the
      // membership tier), so an unscoped supersede would cancel other users'
      // in-flight checkouts.
      const payment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.payment.updateMany({
          where: { purposeType, purposeId, userId, status: "PENDING" },
          data: { status: "FAILED", metaStr: JSON.stringify({ cancelledReason: "superseded_by_new_intent" }) },
        });
        return tx.payment.create({
          data: {
            refNo: paymentRefNo,
            userId,
            purposeType,
            purposeId,
            amountPaisa,
            method: "MOBILE_WALLET",
            providerRef: gatewayRef,
            metaStr: JSON.stringify(gatewayMeta),
          },
        });
      });
      paymentIntentsTotal.inc({ purpose_type: purposeType, status: "created" });

      ok(res, {
        paymentId: payment.id,
        refNo: payment.refNo,
        amountPaisa: payment.amountPaisa,
        providerMode: env.PAYMENT_PROVIDER,
        ...(gatewayRedirectUrl ? { redirectUrl: gatewayRedirectUrl } : {}),
        messageBn: provider.mode === "sandbox" ? "স্যান্ডবক্স মোড — কোনো প্রকৃত অর্থ লেনদেন হবে না।" : undefined,
        messageEn: provider.mode === "sandbox" ? "Sandbox mode — no real money will move." : undefined,
      }, 201);
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
    const res = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "SUCCEEDED", metaStr: JSON.stringify(meta) },
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
 * Sandbox confirm: simulates the gateway return path. Only available when the
 * sandbox provider is actually in use, and — in production — only for a
 * deployment that explicitly opted in (ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION).
 * Live gateways move money exclusively through the verified webhook.
 * Idempotent under concurrency: only the first PENDING->SUCCEEDED claim wins.
 */
paymentsRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    if (env.PAYMENT_PROVIDER !== "sandbox") {
      throw forbidden("Direct confirmation is disabled; complete payment through the gateway");
    }
    if (isProd && env.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION !== "1") {
      throw paymentGatewayUnconfigured();
    }
    const payment = await prisma.payment.findFirst({ where: { id: req.params.id!, userId: req.auth!.userId } });
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
paymentsRouter.get("/:id/status", async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({ where: { id: req.params.id!, userId: req.auth!.userId } });
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
      verdict = await provider.verifyPayment(payment.providerRef ?? payment.refNo);
    } catch (e) {
      throw paymentGatewayUnavailable({ reason: (e as Error).message });
    }

    let reconciled = false;
    if (verdict.status === "SUCCEEDED") {
      reconciled = await claimAndApplyPayment(payment, { mode: env.PAYMENT_PROVIDER, verified: true, amountPaisa: verdict.amountPaisa });
    } else if (verdict.status === "FAILED") {
      await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
    }
    const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    ok(res, { status: final.status, reconciled, providerMode: env.PAYMENT_PROVIDER, providerVerdict: verdict.status });
  } catch (e) {
    next(e);
  }
});

paymentsRouter.get("/", async (req, res, next) => {
  try {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role);
    const payments = await prisma.payment.findMany({
      where: isPrivileged ? {} : { userId: req.auth!.userId },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    ok(res, payments);
  } catch (e) {
    next(e);
  }
});

// ---------------- Refunds (platform-initiated, orders only in v1) ----------------

const refundSchema = z.object({ reason: z.string().trim().min(3).max(500) });

paymentsRouter.post(
  "/:id/refund",
  requirePermission("payments:refund"),
  validate({ body: refundSchema }),
  async (req, res, next) => {
    try {
      const payment = await prisma.payment.findUnique({ where: { id: req.params.id! } });
      if (!payment) throw notFound("Payment");
      if (payment.purposeType === "MEMBERSHIP") {
        throw unprocessable("Membership purchases are non-refundable while active (see Terms)");
      }
      if (payment.purposeType !== "ORDER") {
        throw unprocessable(`Refunds for ${payment.purposeType} are not supported yet`);
      }

      await prisma.$transaction(async (tx) => {
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
        actorId: req.auth!.userId,
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        meta: { reason: req.body.reason },
      });
      await notify({
        userId: payment.userId,
        type: "PAYMENT",
        category: "CRITICAL",
        titleBn: `টাকা ফেরত (${updated.refundRef})`,
        titleEn: `Refund processed (${updated.refundRef})`,
        bodyBn: "আপনার পেমেন্ট ফেরত দেওয়া হয়েছে।",
        bodyEn: "Your payment has been refunded.",
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
      const po = await prisma.procurementOrder.findUnique({ where: { id: req.body.poId as string }, include: { user: { select: { phoneVerified: true } } } });
      if (!po) throw notFound("Procurement order");
      // Payouts are money leaving the platform: a territory-scoped procurement
      // manager may only pay farmers in their own region.
      await assertSubjectInRegion(
        await actorRegionLimit(req.auth!.userId, req.auth!.role),
        po.userId,
        "This procurement order"
      );
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
    const [wallet, transactions] = await Promise.all([
      prisma.wallet.upsert({ where: { userId: req.auth!.userId }, update: {}, create: { userId: req.auth!.userId } }),
      prisma.walletTransaction.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    ok(res, { balancePaisa: wallet.balancePaisa, transactions });
  } catch (e) {
    next(e);
  }
});

/** Financial month-in/out + pending holds + membership snapshot. */
walletRouter.get("/summary", async (req, res, next) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [credits, debits, held, membership] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: { userId: req.auth!.userId, direction: "CREDIT", createdAt: { gte: startOfMonth } },
        _sum: { amountPaisa: true },
      }),
      prisma.walletTransaction.aggregate({
        where: { userId: req.auth!.userId, direction: "DEBIT", createdAt: { gte: startOfMonth } },
        _sum: { amountPaisa: true },
      }),
      // heldPaisa is maintained transactionally under the wallet row lock at
      // request/approve/reject time; it is the source of truth for in-flight
      // withdrawal holds (a cross-check against the Withdrawal table lives in
      // scripts/reconcile-wallet.mjs).
      prisma.wallet.findUnique({ where: { userId: req.auth!.userId }, select: { heldPaisa: true } }),
      getActiveMembership(req.auth!.userId),
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
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
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
        where: { userId: req.auth!.userId },
        update: { heldPaisa: { increment: 0 } },
        create: { userId: req.auth!.userId },
      });
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: req.auth!.userId } });
      const available = wallet.balancePaisa - wallet.heldPaisa;
      if (amountPaisa > available) {
        throw unprocessable("Insufficient available balance (pending withdrawals are held)");
      }
      await tx.wallet.update({
        where: { userId: req.auth!.userId },
        data: { heldPaisa: { increment: amountPaisa } },
      });
      return tx.withdrawal.create({
        data: {
          refNo: refNo("WDL"),
          userId: req.auth!.userId,
          amountPaisa,
          channel,
          destination: maskDestination(user.phone),
        },
      });
    }, { timeout: 15000, maxWait: 8000 });

    await audit({ actorId: req.auth!.userId, action: "WITHDRAWAL_REQUESTED", entityType: "Withdrawal", entityId: withdrawal.id, meta: { amountPaisa } });
    ok(res, withdrawal, 201);
  } catch (e) {
    next(e);
  }
});

walletRouter.get("/withdrawals", async (req, res, next) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.auth!.userId },
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
      plans.map((p) => ({ ...p, benefits: JSON.parse(p.benefitsStr ?? "[]") }))
    );
  } catch (e) {
    next(e);
  }
});

/**
 * SSLCommerz IPN signature validation (documented algorithm):
 * sort all params except verify_sign/verify_key alphabetically, concatenate
 * STORE_PASSWORD + k1=v1 + k2=v2 ... with no separators, MD5 uppercase.
 */
export function sslcommerzSignature(params: Record<string, string>, storePassword: string): string {
  const concat = Object.keys(params)
    .filter((k) => k !== "verify_sign" && k !== "verify_key")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  return createHash("md5").update(storePassword + concat).digest("hex").toUpperCase();
}
