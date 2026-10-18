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
async function paidOrder(): Promise<{ orderId: string; paymentId: string; amountPaisa: number }> {
  const f = await registerFarmer();
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
});
