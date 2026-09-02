import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { refNo } from "../../lib/money.js";
import { getActiveMembership } from "../../lib/membership.js";
import { env, isProd } from "../../config/env.js";
import { paymentIntentsTotal } from "../../lib/metrics.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import type { TransactionClient } from "./payment.repository.js";

/**
 * Pure payment business logic — no Express req/res.
 * Callers supply plain values (userId, purposeType, etc.) and handle
 * HTTP mapping themselves. All DB mutation is idempotent via atomic
 * PENDING->SUCCEEDED / SUCCEEDED->REFUNDED claims.
 */

// ---------------------------------------------------------------------------
// Side effects — called exactly once per successful payment
// ---------------------------------------------------------------------------

export async function applyPaymentSideEffects(
  tx: TransactionClient,
  payment: { purposeType: string; purposeId: string; userId: string },
): Promise<void> {
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
    const base =
      current.expiresAt && current.expiresAt > new Date() ? current.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + durationDays * 86_400_000);
    await tx.farmerProfile.upsert({
      where: { userId: payment.userId },
      update: { membershipTier: payment.purposeId, membershipExpiresAt: expiresAt },
      create: {
        userId: payment.userId,
        membershipTier: payment.purposeId,
        membershipExpiresAt: expiresAt,
      },
    } as never);
  }
}

// ---------------------------------------------------------------------------
// Intent creation
// ---------------------------------------------------------------------------

export type CreateIntentInput = {
  userId: string;
  purposeType: "ORDER" | "BOOKING" | "PROCUREMENT" | "MEMBERSHIP";
  purposeId: string;
};

export type CreateIntentResult = {
  paymentId: string;
  refNo: string;
  amountPaisa: number;
  providerMode: string;
  messageBn?: string;
  messageEn?: string;
};

export async function createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
  const { userId, purposeType, purposeId } = input;

  let amountPaisa: number;
  if (purposeType === "ORDER") {
    const order = await prisma.order.findFirst({
      where: { id: purposeId, userId, status: { in: ["CONFIRMED", "PENDING"] }, paymentStatus: "UNPAID" },
    });
    if (!order) throw notFound("Payable order");
    amountPaisa = order.totalPaisa;
  } else if (purposeType === "BOOKING") {
    const booking = await prisma.booking.findFirst({
      where: { id: purposeId, userId, paymentStatus: "UNPAID", status: { in: ["REQUESTED", "ASSIGNED"] } },
    });
    if (!booking) throw notFound("Payable booking");
    amountPaisa = booking.estimatedPricePaisa;
  } else if (purposeType === "PROCUREMENT") {
    throw badRequest("Procurement payouts are processed via /payouts by procurement managers");
  } else {
    const plan = await prisma.membershipPlan.findUnique({ where: { tier: purposeId } });
    if (!plan || !plan.isActive) throw notFound("Membership plan");
    amountPaisa = plan.pricePaisa;
  }

  const payment = await prisma.$transaction(
    async (tx: TransactionClient) => {
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
    },
    { timeout: 15000, maxWait: 8000 },
  );

  paymentIntentsTotal.inc({ purpose_type: purposeType, status: "created" });

  return {
    paymentId: payment.id,
    refNo: payment.refNo,
    amountPaisa: payment.amountPaisa,
    providerMode: env.PAYMENT_PROVIDER,
    messageBn:
      env.PAYMENT_PROVIDER === "sandbox"
        ? "স্যান্ডবক্স মোড — কোনো প্রকৃত অর্থ লেনদেন হবে না।"
        : undefined,
    messageEn:
      env.PAYMENT_PROVIDER === "sandbox" ? "Sandbox mode — no real money will move." : undefined,
  };
}

// ---------------------------------------------------------------------------
// Confirm (sandbox path — disabled in prod with real gateway)
// ---------------------------------------------------------------------------

export async function confirmPayment(input: { userId: string; paymentId: string }) {
  if (isProd && env.PAYMENT_PROVIDER !== "sandbox") {
    throw forbidden("Direct confirmation is disabled; complete payment through the gateway");
  }

  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, userId: input.userId },
  });
  if (!payment) throw notFound("Payment");
  if (payment.status !== "PENDING") throw conflict(`Payment already ${payment.status}`);

  await prisma.$transaction(
    async (tx: TransactionClient) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "SUCCEEDED" },
      });
      if (claimed.count !== 1) throw conflict(`Payment already ${payment.status}`);
      await applyPaymentSideEffects(tx, payment);
    },
    { timeout: 15000, maxWait: 8000 },
  );

  await audit({
    actorId: input.userId,
    action: "PAYMENT_SUCCEEDED",
    entityType: "Payment",
    entityId: payment.id,
    meta: { sandbox: true },
  });

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

  return { ...payment, status: "SUCCEEDED" as const };
}

// ---------------------------------------------------------------------------
// Helpers for faster testability / reuse
// ---------------------------------------------------------------------------

export async function getPaymentOrThrow(paymentId: string, userId?: string) {
  const payment = userId
    ? await prisma.payment.findFirst({ where: { id: paymentId, userId } })
    : await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound("Payment");
  return payment;
}
