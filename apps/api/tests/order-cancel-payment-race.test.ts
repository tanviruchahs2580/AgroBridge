import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin, createFarmWithCrop } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-101 (S1): a cancelled order could still be paid.
 *
 * `POST /orders/:id/cancel` released the stock while the order was still
 * UNPAID, and the payment side effect only required `paymentStatus: "UNPAID"`.
 * A buyer who had already opened the gateway's checkout page could therefore
 * complete the payment after cancelling: the stock was back in the pool (and
 * sellable to someone else) while their money was captured and the order was
 * flipped to PAID — a paid order whose goods were no longer committed.
 *
 * The interlock is a claim on the same payment row: cancelling voids the
 * PENDING intent (`PENDING -> FAILED`) and the settlement claims
 * (`PENDING -> SUCCEEDED`) only succeed while the row is still PENDING, so
 * exactly one of the two wins.
 */
async function stockProduct(token: string, stockQty: number, qty: number) {
  const admin = await getAdmin();
  const created = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      sku: `RACE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: "Cancel-vs-payment race item",
      category: "EQUIPMENT",
      unit: "PCS",
      pricePaisa: 5_000,
      stockQty,
    });
  expect(created.status).toBe(201);
  const added = await request(app)
    .post("/api/v1/cart/items")
    .set("Authorization", `Bearer ${token}`)
    .send({ productId: created.body.data.id, qty });
  expect(added.status).toBe(201);
  return created.body.data.id as string;
}

async function checkout(token: string): Promise<string> {
  const res = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function intentFor(token: string, purposeType: "ORDER" | "BOOKING", purposeId: string) {
  const res = await request(app)
    .post("/api/v1/payments/intent")
    .set("Authorization", `Bearer ${token}`)
    .send({ purposeType, purposeId });
  expect(res.status).toBe(201);
  return res.body.data.paymentId as string;
}

describe("A cancelled order can no longer be paid (AUD-101)", () => {
  it("cancelling voids the PENDING intent, and a late settlement cannot mark the order PAID", async () => {
    const f = await registerFarmer();
    const productId = await stockProduct(f.accessToken, 10, 4);
    const orderId = await checkout(f.accessToken);
    const paymentId = await intentFor(f.accessToken, "ORDER", orderId);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(6);

    // The buyer cancels while the gateway's checkout page is still open.
    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "changed my mind" });
    expect(cancel.status).toBe(200);

    // The intent is now terminal, and why is recorded for support/reconcile.
    const voided = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(voided.status).toBe("FAILED");
    expect(constantReason(voided.metaStr)).toBe("order_cancelled");

    // The late settlement (sandbox confirm stands in for the gateway's return)
    // must not resurrect the order.
    const late = await request(app)
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(late.status).toBe(409);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("CANCELLED");
    expect(order.paymentStatus).toBe("UNPAID");
    // Restocked exactly once: 10 → 6 at checkout → 10 at cancel, and the late
    // settlement decremented nothing.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(10);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("FAILED");
  });

  it("a settled payment still blocks the cancel (the claim order is what decides)", async () => {
    const f = await registerFarmer();
    const productId = await stockProduct(f.accessToken, 5, 2);
    const orderId = await checkout(f.accessToken);
    const paymentId = await intentFor(f.accessToken, "ORDER", orderId);

    const settled = await request(app)
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(settled.status).toBe(200);

    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "too late" });
    expect(cancel.status).toBe(409);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID");
    // 5 → 3 at checkout, unchanged by the refused cancel.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(3);
  });

  it("cancelling a booking voids its pending intent too", async () => {
    const f = await registerFarmer();
    const farm = await createFarmWithCrop(f.accessToken);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const svc = services.body.data[0];
    const created = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({
        farmId: farm.farmId,
        serviceId: svc.id,
        scheduledFor: new Date(Date.now() + 3 * 86400000).toISOString(),
        areaBigha: 1,
      });
    expect(created.status).toBe(201);
    const bookingId = created.body.data.id as string;

    const paymentId = await intentFor(f.accessToken, "BOOKING", bookingId);
    const cancel = await request(app)
      .post(`/api/v1/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ status: "CANCELLED", reason: "no longer needed" });
    expect(cancel.status).toBe(200);

    const voided = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(voided.status).toBe("FAILED");
    expect(constantReason(voided.metaStr)).toBe("booking_cancelled");

    const late = await request(app)
      .post(`/api/v1/payments/${paymentId}/confirm`)
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(late.status).toBe(409);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).paymentStatus).toBe("UNPAID");
  });
});

/** The void records why it happened; parse it without asserting the rest. */
function constantReason(metaStr: string | null): string | null {
  if (!metaStr) return null;
  try {
    return (JSON.parse(metaStr) as { cancelledReason?: string }).cancelledReason ?? null;
  } catch {
    return null;
  }
}
