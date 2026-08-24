import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { notFound, unprocessable, badRequest } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";
import { refNo } from "../../lib/money.js";
import { notify } from "../../providers/notification/service.js";
import { audit } from "../../middleware/audit.js";

export const paymentsRouter = Router();
export const walletRouter = Router();
export const membershipRouter = Router();

paymentsRouter.use(requireAuth);

/**
 * Payment intent creation. Sandbox provider is used until real credentials
 * exist; the response always exposes provider mode so UI can label it
 * clearly (Rule 53 — never fake success).
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

      const payment = await prisma.payment.create({
        data: {
          refNo: refNo("PAY"),
          userId,
          purposeType,
          purposeId,
          amountPaisa,
          method: "MOBILE_WALLET",
          providerRef: `SBX-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          metaStr: JSON.stringify({ mode: "sandbox" }),
        },
      });

      ok(res, {
        paymentId: payment.id,
        refNo: payment.refNo,
        amountPaisa: payment.amountPaisa,
        providerMode: "sandbox",
        messageBn: "স্যান্ডবক্স মোড — কোনো প্রকৃত অর্থ লেনদেন হবে না।",
        messageEn: "Sandbox mode — no real money will move.",
      }, 201);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * Sandbox confirm: simulates the gateway webhook/return path.
 * Marks payment SUCCEEDED atomically with the business side-effect.
 */
paymentsRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({ where: { id: req.params.id!, userId: req.auth!.userId } });
    if (!payment) throw notFound("Payment");
    if (payment.status !== "PENDING") throw unprocessable(`Payment already ${payment.status}`);

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED" } });

      if (payment.purposeType === "ORDER") {
        await tx.order.update({ where: { id: payment.purposeId }, data: { status: "PAID", paymentStatus: "PAID" } });
      } else if (payment.purposeType === "BOOKING") {
        await tx.booking.update({ where: { id: payment.purposeId }, data: { paymentStatus: "PAID" } });
      } else if (payment.purposeType === "MEMBERSHIP") {
        const expiresAt = new Date(Date.now() + 365 * 86400000);
        await tx.farmerProfile.upsert({
          where: { userId: payment.userId },
          update: { membershipTier: payment.purposeId },
          create: { userId: payment.userId, membershipTier: payment.purposeId },
        });
        void expiresAt;
      }
    });

    await audit({ actorId: req.auth!.userId, action: "PAYMENT_SUCCEEDED", entityType: "Payment", entityId: payment.id, meta: { sandbox: true } });
    await notify({
      userId: payment.userId,
      type: "PAYMENT",
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

// Procurement payout to farmer wallet
const payoutSchema = z.object({ poId: z.string().min(5) });

paymentsRouter.post(
  "/payouts",
  requirePermission("procurement:pay"),
  validate({ body: payoutSchema }),
  async (req, res, next) => {
    try {
      const po = await prisma.procurementOrder.findUnique({ where: { id: req.body.poId as string } });
      if (!po) throw notFound("Procurement order");
      if (po.status !== "COLLECTED") throw unprocessable(`Cannot pay out PO in status ${po.status}`);
      if (po.netPayablePaisa <= 0) throw unprocessable("Nothing payable");

      const result = await prisma.$transaction(async (tx) => {
        // Atomic claim: only the first COLLECTED -> PAID transition wins; concurrent
        // payouts lose the race and abort (prevents double-crediting under PostgreSQL).
        const claimed = await tx.procurementOrder.updateMany({
          where: { id: po.id, status: "COLLECTED" },
          data: { status: "PAID" },
        });
        if (claimed.count !== 1) throw unprocessable("Procurement order already paid");

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
      });

      await notify({
        userId: po.userId,
        type: "PAYMENT",
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
