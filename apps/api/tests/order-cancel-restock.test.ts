import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-121 (S2): checkout decrements stock when it creates a CONFIRMED order,
 * but nothing could ever put that stock back — DELETE refuses in-progress
 * orders, so an unpaid CONFIRMED order was stuck forever. POST /orders/:id/cancel
 * is the owner-only, claim-atomic release path (paid orders are refused).
 */
async function stockOwnProduct(token: string, stockQty: number, qty: number) {
  const admin = await getAdmin();
  const created = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      sku: `CNCL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: "Cancel-restock test item",
      category: "EQUIPMENT",
      unit: "PCS",
      pricePaisa: 4_000,
      stockQty,
    });
  expect(created.status).toBe(201);
  const productId = created.body.data.id as string;
  const added = await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId, qty });
  expect(added.status).toBe(201);
  return productId;
}

async function checkout(token: string): Promise<string> {
  const res = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe("Cancelling an unpaid confirmed order restores stock", () => {
  it("unpaid CONFIRMED order is cancelled and stock is restored exactly once", async () => {
    const f = await registerFarmer();
    const productId = await stockOwnProduct(f.accessToken, 10, 4);
    const orderId = await checkout(f.accessToken);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(6);

    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "changed my mind" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELLED");
    expect(cancel.body.data.cancelReason).toBe("changed my mind");

    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(10);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("CANCELLED");
  });

  it("a body-less cancel works, and a second cancel is refused with 409 without restocking again", async () => {
    const f = await registerFarmer();
    const productId = await stockOwnProduct(f.accessToken, 8, 2);
    const orderId = await checkout(f.accessToken);

    const first = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "retry" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");

    // Restocked once: 8 → 6 at checkout → 8 after the one successful cancel.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(8);
  });

  it("a PAID order cannot be cancelled and its stock is untouched", async () => {
    const f = await registerFarmer();
    const productId = await stockOwnProduct(f.accessToken, 5, 2);
    const orderId = await checkout(f.accessToken);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(3);

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(intent.status).toBe(201);
    const confirm = await request(app)
      .post(`/api/v1/payments/${intent.body.data.paymentId}/confirm`)
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm.status).toBe(200);

    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "wants money back" });
    expect(cancel.status).toBe(409);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.paymentStatus).toBe("PAID");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(3);
  });

  it("another user cannot cancel my order (404, nothing changes)", async () => {
    const f = await registerFarmer();
    const other = await registerFarmer();
    const productId = await stockOwnProduct(f.accessToken, 6, 1);
    const orderId = await checkout(f.accessToken);

    const foreign = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set("Authorization", `Bearer ${other.accessToken}`);
    expect(foreign.status).toBe(404);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CONFIRMED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(5);
  });
});
