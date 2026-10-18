import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-103 (S2): checkout read the cart and then decremented stock / created the
 * order / cleared the cart. Two parallel submits of one cart both saw it and
 * produced two orders and two stock decrements. The cart rows are now the
 * idempotency token: whichever attempt deletes them first wins, the other gets
 * 409 (or 400 when it observes the emptied cart) and changes nothing.
 */
async function stockOwnProduct(token: string, stockQty: number, qty: number) {
  const admin = await getAdmin();
  const created = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      sku: `DBL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: "Double-submit test item",
      category: "EQUIPMENT",
      unit: "PCS",
      pricePaisa: 5_000,
      stockQty,
    });
  expect(created.status).toBe(201);
  const productId = created.body.data.id as string;

  const added = await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId, qty });
  expect(added.status).toBe(201);
  return productId;
}

describe("Checkout duplicate-submit safety", () => {
  it("two parallel submits of one cart: exactly one order, one stock decrement", async () => {
    const f = await registerFarmer();
    const productId = await stockOwnProduct(f.accessToken, 10, 2);

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`),
      request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    // The loser is refused — never a second 201, and never a server error.
    expect([400, 409]).toContain(statuses[1]);
    const loser = a.status === 201 ? b : a;
    if (loser.status === 409) expect(loser.body.error.message).toMatch(/another attempt/i);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stockQty).toBe(8); // decremented exactly once

    const orders = await prisma.order.findMany({ where: { userId: f.user.id }, include: { items: true } });
    expect(orders.length).toBe(1); // exactly one Order row
    expect(orders[0].items.filter((i) => i.productId === productId)).toHaveLength(1);

    const cart = await prisma.cart.findUnique({ where: { userId: f.user.id }, include: { items: true } });
    expect(cart?.items.length ?? 0).toBe(0);
  });

  it("sequential retry after a successful checkout is refused with 'Cart is empty' and leaves stock alone", async () => {
    const f = await registerFarmer();
    const productId = await stockOwnProduct(f.accessToken, 10, 3);

    const first = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`);
    expect(first.status).toBe(201);

    const retry = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`);
    expect(retry.status).toBe(400);
    expect(retry.body.error.message).toMatch(/cart is empty/i);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stockQty).toBe(7);
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(1);
  });
});
