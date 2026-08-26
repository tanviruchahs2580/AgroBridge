import { Router } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { notFound, unprocessable, badRequest, forbidden, phoneNotVerified, conflict } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";
import { refNo } from "../../lib/money.js";
import { getActiveMembership } from "../../lib/membership.js";
import { notify } from "../../providers/notification/service.js";
import { audit } from "../../middleware/audit.js";
import { paymentIntentsTotal } from "../../lib/metrics.js";
import { env, isProd } from "../../config/env.js";

export const paymentsRouter = Router();
export const walletRouter = Router();
export const membershipRouter = Router();

paymentsRouter.use(requireAuth);

/** Mask a payout destination for storage/display (never store full account). */
function maskDestination(phone: string): string {
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

/**
 * Business side effects of a successful payment. Called exactly once per
 * payment because callers must first win the PENDING->SUCCEEDED claim.
 * Side effects themselves are conditional where possible (defense in depth).
 */
export async function applyPaymentSideEffects(tx: {
  order: { updateMany: (args: never) => Promise<{ count: number }> };
  booking: { updateMany: (args: never) => Promise<{ count: number }> };
  farmerProfile: { upsert: (args: never) => Promise<unknown> };
}, payment: { purposeType: string; purposeId: string; userId: string }) {
  if (payment.purposeType === "ORDER") {
    await tx.order.updateMany({
      where: { id: payment.purposeId, paymentStatus: "UNPAID" },
      data: { status: "PAID", paymentStatus: "PAID" },
    } as never);
  } else if (payment.purposeType === "BOOKING") {
    await tx.booking.updateMany({
      where: { id: payment.purposeId, paymentStatus: "UNPAID" },
      data: { paymentStatus: "PAID" },
    } as never);
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
    } as never);
  }
}

/**
 * Payment intent creation. Sandbox provider is used until real credentials
 * exist; the response always exposes provider mode so UI can label it
 * clearly (Rule 53 â€” never fake success).
 */
paymentsRouter.post(
  "/intent",
  validate({
    body: z.object({
      purposeType: z.enum(["ORDER", "BOOKING", "PROCUREMENT", "MEMBERSHIP"]),
      purposeId: z.string().min(5),
    }),
  }),
  async (req, res, next) => {
    try {
      const { purposeType, purposeId } = req.body as { purposeType: string; purposeId: string };

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

      // Cancel any stale PENDING intents for the same purpose so exactly one
      // live intent exists at a time (prevents double-confirm double-spend).
      const payment = await prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({
          where: { purposeType, purposeId, status: "PENDING" },
          data: { status: "FAILED", metaStr: JSON.stringify({ cancelledReason: "superseded_by_new_intent" }) },
        });
        return tx.payment.create({
          data: {
            refNo: refNo("PAY"),
            userId,
            purposeType,
            purposeId,
            amountPaisa,
            method: env.PAYMENT_PROVIDER === "sslcommerz" ? "MOBILE_WALLET" : "MOBILE_WALLET",
            providerRef: `SBX-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            metaStr: JSON.stringify({ mode: env.PAYMENT_PROVIDER }),
          },
        });
      });
      paymentIntentsTotal.inc({ purpose_type: purposeType, status: "created" });

      ok(res, {
        paymentId: payment.id,
        refNo: payment.refNo,
        amountPaisa: payment.amountPaisa,
        providerMode: env.PAYMENT_PROVIDER,
        messageBn: env.PAYMENT_PROVIDER === "sandbox" ? "স্যান্ডবক্স মোড — কোনো প্রকৃত অর্থ লেনদেন হবে না।" : undefined,
        messageEn: env.PAYMENT_PROVIDER === "sandbox" ? "Sandbox mode â€” no real money will move." : undefined,
      }, 201);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * Sandbox confirm: simulates the gateway return path. Disabled when the
 * production configuration uses a real gateway â€” money then moves ONLY via
 * the verified webhook (webhook.ts).
 * Idempotent under concurrency: only the first PENDING->SUCCEEDED claim wins.
 */
paymentsRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    if (isProd && env.PAYMENT_PROVIDER !== "sandbox") {
      throw forbidden("Direct confirmation is disabled; complete payment through the gateway");
    }
    const payment = await prisma.payment.findFirst({ where: { id: req.params.id!, userId: req.auth!.userId } });
    if (!payment) throw notFound("Payment");
    if (payment.status !== "PENDING") throw conflict(`Payment already ${payment.status}`);

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "SUCCEEDED" },
      });
      if (claimed.count !== 1) throw conflict(`Payment already ${payment.status}`);

      await applyPaymentSideEffects(tx as never, payment);
    }, { timeout: 15000, maxWait: 8000 });

    await audit({ actorId: req.auth!.userId, action: "PAYMENT_SUCCEEDED", entityType: "Payment", entityId: payment.id, meta: { sandbox: true } });
    await notify({
      userId: payment.userId,
      type: "PAYMENT",
      category: "CRITICAL",
      titleBn: `পেমেন্ট সফল (${payment.refNo})`,
      titleEn: `Payment successful (${payment.refNo})`,
      bodyBn: "স্যান্ডবক্স লেনদেন।",
      bodyEn: "Sandbox transaction.",
      refType: "PAYMENT",
      refId: payment.id,
    });
    ok(res, { ...payment, status: "SUCCEEDED" });
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

      const result = await prisma.$transaction(async (tx) => {
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
        return { refundRef: `RFND-${payment.id}` };
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
        titleEn: `Refund processed (${result.refundRef})`,
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
      if (!po.user.phoneVerified && isProd) throw phoneNotVerified();
      if (po.status !== "COLLECTED") throw unprocessable(`Cannot pay out PO in status ${po.status}`);
      if (po.netPayablePaisa <= 0) throw unprocessable("Nothing payable");

      const result = await prisma.$transaction(async (tx) => {
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

    const [credits, debits, pendingWithdrawals, membership] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: { userId: req.auth!.userId, direction: "CREDIT", createdAt: { gte: startOfMonth } },
        _sum: { amountPaisa: true },
      }),
      prisma.walletTransaction.aggregate({
        where: { userId: req.auth!.userId, direction: "DEBIT", createdAt: { gte: startOfMonth } },
        _sum: { amountPaisa: true },
      }),
      prisma.withdrawal.aggregate({
        where: { userId: req.auth!.userId, status: { in: ["PENDING", "APPROVED"] } },
        _sum: { amountPaisa: true },
      }),
      getActiveMembership(req.auth!.userId),
    ]);

    ok(res, {
      monthCreditsPaisa: credits._sum.amountPaisa ?? 0,
      monthDebitsPaisa: debits._sum.amountPaisa ?? 0,
      pendingWithdrawalsPaisa: pendingWithdrawals._sum.amountPaisa ?? 0,
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

walletRouter.post("/withdrawals", validate({ body: withdrawalSchema }), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw notFound("User");
    if (!user.phoneVerified && isProd) throw phoneNotVerified();

    const { amountPaisa, channel } = req.body as { amountPaisa: number; channel: string };

    const withdrawal = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: req.auth!.userId },
        update: {},
        create: { userId: req.auth!.userId },
      });
      const pending = await tx.withdrawal.aggregate({
        where: { userId: req.auth!.userId, status: { in: ["PENDING", "APPROVED"] } },
        _sum: { amountPaisa: true },
      });
      const available = wallet.balancePaisa - (pending._sum.amountPaisa ?? 0);
      if (amountPaisa > available) {
        throw unprocessable("Insufficient available balance (pending withdrawals are held)");
      }
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
