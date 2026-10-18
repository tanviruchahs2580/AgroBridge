import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-125: a client-supplied checkout idempotency key (`clientRequestId`).
 * The cart-claim gate stays for keyless clients, but a keyed request replays
 * the order the key first produced — sequentially, after a reload, or when two
 * parallel submits race. Contract: one key = one order for its lifetime, even
 * if the key is later re-used for a different cart.
 */
async function stockProduct(stockQty: number, qty: number, token: string) {
  const admin = await getAdmin();
  const created = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      sku: `IDEM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Idempotency key test item",
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

const key = () => `ck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

describe("Checkout idempotency key (AUD-125)", () => {
  it("same key twice sequentially: second returns 200 with the SAME order id, stock decremented once", async () => {
    const f = await registerFarmer();
    const productId = await stockProduct(10, 2, f.accessToken);
    const clientRequestId = key();

    const first = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ clientRequestId });
    expect(first.status).toBe(201);
    expect(first.body.data.clientRequestId).toBe(clientRequestId);

    const retry = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ clientRequestId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.orderNo).toBe(first.body.data.orderNo);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(8);
    expect(await prisma.order.count({ where: { userId: f.user.id, clientRequestId } })).toBe(1);
    // The replay applied no stock/ledger side effects at all.
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(1);
  });

  it("same key on a later DIFFERENT cart still replays the first order (one key = one order)", async () => {
    const f = await registerFarmer();
    const firstProduct = await stockProduct(10, 1, f.accessToken);
    const clientRequestId = key();

    const first = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ clientRequestId });
    expect(first.status).toBe(201);

    // A brand-new cart, a different product, the SAME key.
    const secondProduct = await stockProduct(10, 4, f.accessToken);
    const replayed = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ clientRequestId });

    expect(replayed.status).toBe(200);
    expect(replayed.body.data.id).toBe(first.body.data.id);

    // No side effects: first product stock is 9 (one order), second untouched,
    // and the new cart line is still there (not consumed).
    expect((await prisma.product.findUniqueOrThrow({ where: { id: firstProduct } })).stockQty).toBe(9);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: secondProduct } })).stockQty).toBe(10);
    const cart = await prisma.cart.findUnique({ where: { userId: f.user.id }, include: { items: true } });
    expect(cart?.items.map((i) => i.productId)).toEqual([secondProduct]);
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(1);
  });

  it("different keys: two separate orders", async () => {
    const f = await registerFarmer();
    const productId = await stockProduct(10, 1, f.accessToken);

    const first = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ clientRequestId: key() });
    expect(first.status).toBe(201);

    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${f.accessToken}`).send({ productId, qty: 1 });
    const second = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ clientRequestId: key() });
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(8);
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(2);
  });

  it("no key: cart-claim behaviour is unchanged (second sequential attempt fails)", async () => {
    const f = await registerFarmer();
    await stockProduct(10, 1, f.accessToken);

    const first = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`);
    expect(first.status).toBe(201);
    expect(first.body.data.clientRequestId).toBeNull();

    const second = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`);
    expect(second.status).toBe(400);
    expect(second.body.error.message).toMatch(/cart is empty/i);
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(1);
  });

  it("parallel same-key double submit: exactly one order exists (SQLite + PG)", async () => {
    const f = await registerFarmer();
    const productId = await stockProduct(10, 2, f.accessToken);
    const clientRequestId = key();

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`).send({ clientRequestId }),
      request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`).send({ clientRequestId }),
    ]);

    // No server errors either way; the loser either replays (200) or is refused
    // (400/409) when the winner had not committed yet at lookup time.
    expect(a.status).toBeLessThan(500);
    expect(b.status).toBeLessThan(500);
    expect([a.status, b.status]).toContain(201);
    const loser = a.status === 201 ? b : a;
    expect([200, 400, 409]).toContain(loser.status);

    const orders = await prisma.order.findMany({ where: { userId: f.user.id, clientRequestId } });
    expect(orders).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(8);

    // The client's retry after a lost race replays the winner.
    const retry = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ clientRequestId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(orders[0]!.id);
  });
});
