import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * CMP-01 / FIX-02: DELETE /auth/me must block only on genuinely in-flight
 * orders (PENDING/CONFIRMED/SHIPPED — unpaid, pre-fulfilment) and proceed for
 * settled history (PAID/DELIVERED/REFUNDED/CANCELLED), which the anonymisation
 * transaction retains. The old guard refused unless every order was CANCELLED —
 * or the never-written "DELETED" — so any customer who had ever paid could not
 * self-delete, and the only escape was the PAY-06 hard-delete hole.
 */

async function checkoutOrder(token: string): Promise<string> {
  const before = await request(app).get("/api/v1/products?search=ইউরিয়া").set("Authorization", `Bearer ${token}`);
  const product = before.body.data.items[0];
  expect(product).toBeTruthy();
  await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: product.id, qty: 1 });
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(checkout.status).toBe(201);
  return checkout.body.data.id as string;
}

async function payOrder(token: string, orderId: string): Promise<string> {
  const intent = await request(app)
    .post("/api/v1/payments/intent")
    .set("Authorization", `Bearer ${token}`)
    .send({ purposeType: "ORDER", purposeId: orderId });
  expect(intent.status).toBe(201);
  const confirm = await request(app)
    .post(`/api/v1/payments/${intent.body.data.paymentId}/confirm`)
    .set("Authorization", `Bearer ${token}`);
  expect(confirm.status).toBe(200);
  return intent.body.data.paymentId as string;
}

describe("CMP-01 — account deletion vs the order lifecycle", () => {
  it("blocks while an order is CONFIRMED (in flight)", async () => {
    const f = await registerFarmer();
    await checkoutOrder(f.accessToken);
    const res = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UNPROCESSABLE");
  });

  it("blocks while an order is PENDING or SHIPPED (statuses set directly — BR-11: no writer exists yet)", async () => {
    for (const status of ["PENDING", "SHIPPED"] as const) {
      const f = await registerFarmer();
      const orderId = await checkoutOrder(f.accessToken);
      await prisma.order.update({ where: { id: orderId }, data: { status } });
      const res = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
      expect(res.status).toBe(422);
    }
  });

  it("allows deletion with a PAID order — anonymisation retains the financial record, masks shipping contact", async () => {
    const f = await registerFarmer();
    const orderId = await checkoutOrder(f.accessToken);
    await payOrder(f.accessToken, orderId);
    // The buyer's shipping contact is exactly the personal data the deletion
    // promise covers (SEC-10/CMP-01 follow-through): financial content stays,
    // raw contact fields do not.
    await prisma.order.update({
      where: { id: orderId },
      data: { shippingName: "Real Name", shippingPhone: "01712345678", shippingAddress: "Village, Upazila, District" },
    });
    const res = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order).not.toBeNull(); // kept for legal/financial retention
    expect(order?.shippingName).toBe("Deleted User");
    expect(order?.shippingPhone).toBeNull();
    expect(order?.shippingAddress).toBeNull();
    expect(order?.totalPaisa).toBeGreaterThan(0); // financial content retained
    const user = await prisma.user.findUnique({ where: { id: f.user.id } });
    expect(user?.status).toBe("DISABLED");
    expect(user?.fullName).toBe("Deleted User");
  });

  it("allows deletion with a REFUNDED order (refund → delete is the legal path)", async () => {
    const f = await registerFarmer();
    const orderId = await checkoutOrder(f.accessToken);
    const paymentId = await payOrder(f.accessToken, orderId);
    const refund = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${(await getAdmin()).accessToken}`)
      .send({ reason: "CMP-01 regression fixture" });
    expect(refund.status).toBe(200);
    const res = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe("REFUNDED");
  });

  it("allows deletion with a CANCELLED order", async () => {
    const f = await registerFarmer();
    const orderId = await checkoutOrder(f.accessToken);
    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "no longer needed" });
    expect(cancel.status).toBeLessThan(300);
    const res = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
  });

  it("allows deletion with a DELIVERED order (no writer exists yet — BR-11; status set directly)", async () => {
    const f = await registerFarmer();
    const orderId = await checkoutOrder(f.accessToken);
    await prisma.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
    const res = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
  });
});
