import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUserWithRole, getAdmin, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * F-75: refunds carried a single permission (`payments:refund`) with no duty
 * split, so the actor who owns the payment could also record its refund.
 * `assertNotSelfDealing` (lib/separationOfDuties.ts) now applies to
 * `POST /payments/:id/refund` — SUPER_ADMIN keeps the documented break-glass
 * exception. (The withdrawal-decision route in `admin/routes.ts` is owned by
 * another stream; the exact patch is reported, not applied here.)
 *
 * F-25: the gateway-refund path debits the farmer's wallet for money returned
 * by the gateway. The behaviour is deliberate (BR-35, tested) and is NOT
 * changed — the response and the notification now label it as platform
 * bookkeeping rather than a wallet movement the buyer made.
 */

async function paidOrderId(token: string): Promise<string> {
  const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${token}`);
  const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > 5);
  expect(product, "a product with stock is required").toBeTruthy();
  await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: product.id, qty: 1 });
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(checkout.status).toBe(201);

  const intent = await request(app)
    .post("/api/v1/payments/intent")
    .set("Authorization", `Bearer ${token}`)
    .send({ purposeType: "ORDER", purposeId: checkout.body.data.id });
  expect(intent.status).toBe(201);
  const confirm = await request(app).post(`/api/v1/payments/${intent.body.data.paymentId}/confirm`).set("Authorization", `Bearer ${token}`);
  expect(confirm.status).toBe(200);
  return intent.body.data.paymentId as string;
}

describe("Refund separation of duties (F-75)", () => {
  it("an actor cannot refund their OWN payment: 403 before any write", async () => {
    const admin = await getAdmin();
    const paymentId = await paidOrderId(admin.accessToken);

    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ reason: "I regret this purchase" });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/separation of duties/i);

    // Nothing moved: payment final, no refund stamp, no ledger entry, no audit.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.refundRef ?? null).toBeNull();
    expect(payment.refundedAt ?? null).toBeNull();
    expect(await prisma.walletTransaction.count({ where: { refType: "PAYMENT", refId: paymentId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_REFUNDED", entityId: paymentId } })).toBe(0);
  });

  it("a different actor with the same permission can still refund it", async () => {
    const buyer = await createUserWithRole("ADMIN");
    const paymentId = await paidOrderId(buyer.accessToken);

    const admin = await getAdmin();
    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ reason: "Wrong item delivered to the buyer" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REFUNDED");
  });

  it("SUPER_ADMIN keeps the documented break-glass exception", async () => {
    const superAdmin = await createUserWithRole("SUPER_ADMIN");
    const paymentId = await paidOrderId(superAdmin.accessToken);

    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${superAdmin.accessToken}`)
      .send({ reason: "Single-operator deployment settling its own order" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REFUNDED");
  });

  it("a farmer without the permission is refused by the permission gate, not the duty split", async () => {
    const admin = await getAdmin();
    const paymentId = await paidOrderId(admin.accessToken);
    const farmer = await registerFarmer();

    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ reason: "self-service attempt" });
    expect(res.status).toBe(403);
  });
});

describe("Refund wallet debit is labelled platform bookkeeping (F-25, behaviour unchanged)", () => {
  it("labels the response and the notification, and still writes the compensating ledger entry", async () => {
    // English-preferring buyer so the notification copy is asserted verbatim.
    const farmer = await registerFarmer({ langPref: "en" });
    const paymentId = await paidOrderId(farmer.accessToken);
    const before = await prisma.wallet.findUnique({ where: { userId: farmer.user.id } });

    const admin = await getAdmin();
    const res = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ reason: "Order could not be fulfilled" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REFUNDED");
    expect(res.body.data.walletImpact).toBe("PLATFORM_BOOKKEEPING_DEBIT");

    // Behaviour unchanged: the debit is still written (documented BR-35).
    const ledger = await prisma.walletTransaction.findFirstOrThrow({
      where: { refType: "PAYMENT", refId: paymentId, direction: "DEBIT" },
    });
    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: farmer.user.id } });
    expect(after.balancePaisa).toBe((before?.balancePaisa ?? 0) - ledger.amountPaisa);

    // The audit trail carries the same label.
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: "PAYMENT_REFUNDED", entityId: paymentId },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow.metaStr ?? "").toContain("PLATFORM_BOOKKEEPING_DEBIT");

    // And the buyer is told, in their own language, that this is bookkeeping.
    const notification = await prisma.notification.findFirstOrThrow({
      where: { type: "PAYMENT", refId: paymentId, category: "CRITICAL" },
      orderBy: { createdAt: "desc" },
    });
    expect(`${notification.title} ${notification.body}`).toMatch(/platform bookkeeping/i);
    expect(notification.body).toMatch(/not a wallet movement/i);
  });
});
