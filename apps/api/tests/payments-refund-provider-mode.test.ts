import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";

/**
 * AUD-105 (S1): the refund endpoint flipped a payment to REFUNDED and wrote a
 * wallet-ledger DEBIT without ever calling a gateway — with a live provider
 * that is a false "refunded" state. It is now gated to the sandbox provider
 * (checked before any write, same resolution as /intent) and the notification
 * says plainly that it is a sandbox wallet entry, not gateway money.
 */
async function paidOrder(overrides: Partial<{ langPref: string }> = {}): Promise<{ orderId: string; paymentId: string; amountPaisa: number }> {
  const f = await registerFarmer(overrides);
  const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${f.accessToken}`);
  const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > 5);
  expect(product).toBeTruthy();
  await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${f.accessToken}`).send({ productId: product.id, qty: 1 });
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`);
  expect(checkout.status).toBe(201);

  const intent = await request(app)
    .post("/api/v1/payments/intent")
    .set("Authorization", `Bearer ${f.accessToken}`)
    .send({ purposeType: "ORDER", purposeId: checkout.body.data.id });
  expect(intent.status).toBe(201);
  const paymentId = intent.body.data.paymentId as string;
  const confirm = await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
  expect(confirm.status).toBe(200);

  return { orderId: checkout.body.data.id as string, paymentId, amountPaisa: intent.body.data.amountPaisa as number };
}

describe("Refund endpoint — sandbox-only, honest copy", () => {
  it("sandbox refund still works and the notification says it is a sandbox wallet entry", async () => {
    const { paymentId } = await paidOrder();
    const admin = await getAdmin();

    const refund = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ reason: "Order could not be fulfilled" });
    expect(refund.status).toBe(200);
    expect(refund.body.data.status).toBe("REFUNDED");

    const notification = await prisma.notification.findFirstOrThrow({
      where: { type: "PAYMENT", refId: paymentId, category: "CRITICAL" },
      orderBy: { createdAt: "desc" },
    });
    expect(`${notification.title} ${notification.body}`).toMatch(/স্যান্ডবক্স|sandbox/i);
  });

  it("with a live provider configured the endpoint refuses with 422 before any write", async () => {
    // (C-15 residual) The message must name BOTH the dashboard step and the
    // required `gatewayRef` field so an operator knows how to record it.
    const { orderId, paymentId } = await paidOrder();
    const walletBefore = await prisma.walletTransaction.count({ where: { refType: "PAYMENT", refId: paymentId } });
    const admin = await getAdmin();

    // Mirror the configuration that activates the live gateway for
    // getPaymentProvider() (PAYMENT_PROVIDER + SSLCommerz credentials).
    const prevProvider = env.PAYMENT_PROVIDER;
    const prevStoreId = env.SSLCOMMERZ_STORE_ID;
    try {
      env.PAYMENT_PROVIDER = "sslcommerz";
      env.SSLCOMMERZ_STORE_ID = "test-store-id";
      const refund = await request(app)
        .post(`/api/v1/payments/${paymentId}/refund`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ reason: "Refund attempt on live gateway" });
      expect(refund.status).toBe(422);
      expect(refund.body.error.message).toMatch(/gateway dashboard/i);
      expect(refund.body.error.message).toMatch(/gatewayRef/);
    } finally {
      env.PAYMENT_PROVIDER = prevProvider;
      env.SSLCOMMERZ_STORE_ID = prevStoreId;
    }

    // No rows changed: payment still SUCCEEDED, order still PAID, no ledger entry.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.refundRef ?? null).toBeNull();
    expect(payment.refundedAt ?? null).toBeNull();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.paymentStatus).toBe("PAID");
    expect(await prisma.walletTransaction.count({ where: { refType: "PAYMENT", refId: paymentId } })).toBe(walletBefore);
  });

  it("live provider WITH gatewayRef: records the operator-supplied reference (no gateway call) with ledger + audit + notification", async () => {
    // English-preferring buyer so the notification copy is asserted verbatim.
    const { orderId, paymentId, amountPaisa } = await paidOrder({ langPref: "en" });
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const walletBefore = await prisma.wallet.findUnique({ where: { userId: before.userId } });
    const ledgerBefore = await prisma.walletTransaction.count({ where: { refType: "PAYMENT", refId: paymentId } });
    const admin = await getAdmin();
    const gatewayRef = "GW-REF-778899";

    const prevProvider = env.PAYMENT_PROVIDER;
    const prevStoreId = env.SSLCOMMERZ_STORE_ID;
    let refundStatus = 0;
    let refundRef: string | null = null;
    try {
      env.PAYMENT_PROVIDER = "sslcommerz";
      env.SSLCOMMERZ_STORE_ID = "test-store-id";
      const refund = await request(app)
        .post(`/api/v1/payments/${paymentId}/refund`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ reason: "Refund issued in gateway dashboard", gatewayRef });
      refundStatus = refund.status;
      refundRef = (refund.body.data?.refundRef ?? null) as string | null;
    } finally {
      env.PAYMENT_PROVIDER = prevProvider;
      env.SSLCOMMERZ_STORE_ID = prevStoreId;
    }

    // Simulated money moved: payment REFUNDED under the SUPPLIED reference —
    // never a generated RFND-… (that would claim a gateway refund we cannot prove).
    expect(refundStatus).toBe(200);
    expect(refundRef).toBe(gatewayRef);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("REFUNDED");
    expect(payment.refundRef).toBe(gatewayRef);
    expect(payment.refundedAt).not.toBeNull();
    expect(payment.amountPaisa).toBe(amountPaisa);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("REFUNDED");
    expect(order.paymentStatus).toBe("REFUNDED");

    // Compensating wallet-ledger entry, exactly one.
    expect(await prisma.walletTransaction.count({ where: { refType: "PAYMENT", refId: paymentId } })).toBe(ledgerBefore + 1);
    const ledger = await prisma.walletTransaction.findFirstOrThrow({
      where: { refType: "PAYMENT", refId: paymentId, direction: "DEBIT" },
    });
    expect(ledger.amountPaisa).toBe(amountPaisa);
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: before.userId } });
    expect(ledger.balanceAfterPaisa).toBe(walletAfter.balancePaisa);
    expect(walletAfter.balancePaisa).toBe((walletBefore?.balancePaisa ?? 0) - amountPaisa);

    // Audit trail carries both the reason and the gateway reference.
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: "PAYMENT_REFUNDED", entityId: paymentId },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow.metaStr ?? "").toContain(gatewayRef);
    expect(auditRow.metaStr ?? "").toContain("Refund issued in gateway dashboard");

    // The buyer is told it is a RECORD of a gateway refund, with the ref, and
    // that the wallet entry documents it.
    const notification = await prisma.notification.findFirstOrThrow({
      where: { type: "PAYMENT", refId: paymentId, category: "CRITICAL" },
      orderBy: { createdAt: "desc" },
    });
    expect(`${notification.title} ${notification.body}`).toContain(gatewayRef);
    expect(`${notification.title} ${notification.body}`).toMatch(/recorded with gateway reference/i);
    expect(notification.body).toMatch(/documents it/i);
  });
});
