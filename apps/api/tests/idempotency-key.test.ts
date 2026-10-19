import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, getAdmin, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * `Idempotency-Key` header on the money paths, additively: checkout and
 * payment-intent creation. The header is the standard spelling of the key
 * checkout already accepted in its body; body support stays for older clients.
 * Pinned here: same key twice = one order/payment with a 200 replay, different
 * keys stay unrelated, and a malformed header is refused (never silently
 * ignored — the client sent it expecting replay protection).
 */

async function stockProduct(stockQty: number, qty: number, token: string): Promise<string> {
  const admin = await getAdmin();
  const created = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({
      sku: `IK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Idempotency header test item",
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

/** Places an UNPAID order for the user and returns its id. */
async function createOrder(token: string): Promise<string> {
  await stockProduct(10, 1, token);
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(checkout.status).toBe(201);
  return checkout.body.data.id as string;
}

const key = () => `ik-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

describe("Idempotency-Key header — checkout", () => {
  it("same header twice: 201 then a 200 replay of the SAME order, stock moved once", async () => {
    const f = await registerFarmer();
    const productId = await stockProduct(10, 2, f.accessToken);
    const header = key();

    const first = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header);
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.orderNo).toBe(first.body.data.orderNo);

    expect(await prisma.order.count({ where: { userId: f.user.id, clientRequestId: header } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQty).toBe(8);
  });

  it("the header wins when a body key is also present", async () => {
    const f = await registerFarmer();
    await stockProduct(10, 1, f.accessToken);
    const header = key();
    const bodyKey = key();

    const first = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ clientRequestId: bodyKey });
    expect(first.status).toBe(201);
    expect(first.body.data.clientRequestId).toBe(header);

    // The body key is inert on this request; neither key replays a second order.
    const retry = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ clientRequestId: bodyKey });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await prisma.order.count({ where: { userId: f.user.id, clientRequestId: bodyKey } })).toBe(0);
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(1);
  });

  it("different headers produce unrelated orders", async () => {
    const f = await registerFarmer();
    const productId = await stockProduct(10, 1, f.accessToken);

    const first = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", key());
    expect(first.status).toBe(201);

    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${f.accessToken}`).send({ productId, qty: 1 });
    const second = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", key());
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(2);
  });

  it("a malformed header is refused with 400 and nothing is created", async () => {
    const f = await registerFarmer();
    await stockProduct(10, 1, f.accessToken);

    const res = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "short");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(0);
  });
});

describe("Idempotency-Key header — payment intent", () => {
  it("same header twice: 201 then a 200 replay of the SAME payment, no supersede", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const header = key();

    const first = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(first.body.data.paymentId);
    expect(retry.body.data.refNo).toBe(first.body.data.refNo);

    const rows = await prisma.payment.findMany({ where: { userId: f.user.id, purposeType: "ORDER", purposeId: orderId } });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.status).toBe("PENDING"); // the replay did not supersede it
    expect(row?.metaStr).toContain(header);
  });

  it("different headers behave like the existing one-live-intent lifecycle (second supersedes the first)", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);

    const first = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", key())
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", key())
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(second.status).toBe(201);
    expect(second.body.data.paymentId).not.toBe(first.body.data.paymentId);

    const stale = await prisma.payment.findUniqueOrThrow({ where: { id: first.body.data.paymentId } });
    expect(stale.status).toBe("FAILED");
    const live = await prisma.payment.findUniqueOrThrow({ where: { id: second.body.data.paymentId } });
    expect(live.status).toBe("PENDING");
  });

  it("replays the original payment even after it was confirmed", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const header = key();

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(intent.status).toBe(201);
    const paymentId = intent.body.data.paymentId as string;

    const confirm = await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe("SUCCEEDED");

    // Retry after the money path finished: the key still resolves to THIS
    // payment (not a 404 for the now-PAID order, not a second intent).
    const retry = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(paymentId);
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeType: "ORDER", purposeId: orderId } })).toBe(1);
  });

  it("a malformed header is refused with 400", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);

    const res = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "bad\tkey-0123456789")
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});
