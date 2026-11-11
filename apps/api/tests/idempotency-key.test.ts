import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, getAdmin, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sslcommerzSignature } from "../src/modules/payments/routes.js";
import { env } from "../src/config/env.js";

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

  it("a body key that repeats the header is accepted; a mismatching pair is refused", async () => {
    const f = await registerFarmer();
    await stockProduct(10, 1, f.accessToken);

    // Same key on both channels: one channel. The shipped contract (ARC-10)
    // treats the header as a mapping onto the body's clientRequestId, so a
    // divergent pair is ambiguous enough to refuse.
    const same = key();
    const first = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", same)
      .send({ clientRequestId: same });
    expect(first.status).toBe(201);
    expect(first.body.data.clientRequestId).toBe(same);

    const header = key();
    const bodyKey = key();
    const mismatch = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ clientRequestId: bodyKey });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_KEY_MISMATCH");
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
    expect(res.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(0);
  });

  /**
   * F-74: the two validators for this header disagreed — the header mapper
   * accepted 8..100 non-space chars while `context.ts` documented and enforced
   * 8..128 (spaces allowed). There is now ONE bound (8..100), so the edge that
   * used to be ambiguous is pinned: 100 chars is accepted, 101 is refused, and a
   * key containing a space is refused on BOTH paths (checkout's mapper and the
   * payment-intent path that reads the header directly).
   */
  it("the idempotency bound is single: 100 chars accepted, 101 refused, spaces refused on every path", async () => {
    const f = await registerFarmer();
    await stockProduct(10, 1, f.accessToken);
    const boundary100 = "k".repeat(100);

    const accepted = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", boundary100);
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.clientRequestId).toBe(boundary100);

    // The exact length the old context.ts validator allowed and the mapper
    // refused: it must now be refused everywhere. (The mapper rejects before
    // the handler, so no cart state is needed for this one.)
    const tooLong = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "k".repeat(101));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");

    const withSpace = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "key with spaces");
    expect(withSpace.status).toBe(400);
    expect(withSpace.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");

    // The same bounds on the payment path, which reads the header itself.
    const orderId = await createOrder(f.accessToken);
    const directTooLong = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "k".repeat(101))
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(directTooLong.status).toBe(400);

    const directWithSpace = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "key with spaces")
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(directWithSpace.status).toBe(400);
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
    expect(res.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });
});

/** The store password the IPN signature is computed with (set in tests/setup-env.ts). */
function storePassword(): string {
  const value = env.SSLCOMMERZ_STORE_PASSWORD;
  if (!value) throw new Error("SSLCOMMERZ_STORE_PASSWORD must be set for tests (tests/setup-env.ts)");
  return value;
}

/** A correctly signed SSLCommerz IPN for the given payload. */
function signedWebhookParams(params: Record<string, string>): Record<string, string> {
  return { ...params, verify_key: "unused", verify_sign: sslcommerzSignature(params, storePassword()) };
}

/**
 * F-02: the signed webhook — the ONLY success path for real money — wrote
 * `metaStr: JSON.stringify({mode, valId, verified})` and replaced the client
 * key the sandbox/confirm path deliberately preserved. A client retrying intent
 * creation after a lost webhook response therefore found no replay. The webhook
 * now claims through the same shared helper (claimPendingPayment), so both
 * settlement paths compose the final meta from the row's current value.
 */
describe("Idempotency-Key header — key survival through the signed webhook (F-02)", () => {
  it("a keyed ORDER payment confirmed by the webhook still replays under its key", async () => {
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

    const hit = await request(app)
      .post("/api/v1/payments/webhook/sslcommerz")
      .type("form")
      .send(
        signedWebhookParams({
          tran_id: intent.body.data.refNo as string,
          val_id: "GW-KEY-SURVIVAL-ORDER",
          status: "VALID",
          amount: (intent.body.data.amountPaisa / 100).toFixed(2),
          currency: "BDT",
        })
      );
    expect(hit.status).toBe(200);
    expect(hit.body.data.processed).toBe(true);

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(row.status).toBe("SUCCEEDED");
    expect(row.metaStr ?? "").toContain(header); // the fix: the key survived
    expect(row.metaStr ?? "").toContain('"verified":true');

    // The retry after a lost webhook response: the SAME payment, not a new
    // intent for an order that is now PAID.
    const retry = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(paymentId);
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeId: orderId } })).toBe(1);
  });

  it("a keyed MEMBERSHIP intent confirmed by the webhook does not open a second payable intent", async () => {
    const f = await registerFarmer();
    const header = key();

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "MEMBERSHIP", purposeId: "SILVER" });
    expect(intent.status).toBe(201);
    const paymentId = intent.body.data.paymentId as string;

    const hit = await request(app)
      .post("/api/v1/payments/webhook/sslcommerz")
      .type("form")
      .send(
        signedWebhookParams({
          tran_id: intent.body.data.refNo as string,
          val_id: "GW-KEY-SURVIVAL-MEMBERSHIP",
          status: "VALID",
          amount: (intent.body.data.amountPaisa / 100).toFixed(2),
          currency: "BDT",
        })
      );
    expect(hit.status).toBe(200);
    expect(hit.body.data.processed).toBe(true);

    // MEMBERSHIP intentionally has no payable-state guard, so a retry under a
    // key the webhook destroyed would create a SECOND payable intent — exactly
    // the double-charge the key exists to prevent.
    const retry = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "MEMBERSHIP", purposeId: "SILVER" });
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(paymentId);
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeType: "MEMBERSHIP" } })).toBe(1);
  });
});

/**
 * F-23: the two void paths (order/booking cancel via voidPendingIntents and
 * the supersede inside POST /payments/intent) wrote a constant metaStr and
 * shredded the client key the same way the webhook did — the opposite of
 * findPaymentByClientKey's documented contract that a keyed retry must find the
 * payment once it is no longer PENDING.
 */
describe("Idempotency-Key header — key survival through the void paths (F-23)", () => {
  it("order cancel keeps the key on the voided intent, so a retry replays the FAILED row", async () => {
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

    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "changed my mind" });
    expect(cancel.status).toBe(200);

    const voided = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(voided.status).toBe("FAILED");
    expect(voided.metaStr ?? "").toContain("order_cancelled");
    expect(voided.metaStr ?? "").toContain(header); // the fix: merged, not replaced

    const retry = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(paymentId);
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeId: orderId } })).toBe(1);
  });

  it("supersede keeps the EARLIER key: a retry under the first key replays the superseded row", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const firstKey = key();

    const first = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", firstKey)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", key())
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(second.status).toBe(201);
    expect(second.body.data.paymentId).not.toBe(first.body.data.paymentId);

    const firstRow = await prisma.payment.findUniqueOrThrow({ where: { id: first.body.data.paymentId } });
    expect(firstRow.status).toBe("FAILED");
    expect(firstRow.metaStr ?? "").toContain("superseded_by_new_intent");
    expect(firstRow.metaStr ?? "").toContain(firstKey); // the fix: merged, not replaced

    const replay = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", firstKey)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(replay.status).toBe(200);
    expect(replay.body.data.paymentId).toBe(first.body.data.paymentId);
  });

  it("a pre-migration row (key only in metaStr) survives the void with its key", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const header = key();

    const legacy = await prisma.payment.create({
      data: {
        refNo: `PAY-LEGACY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: f.user.id,
        purposeType: "ORDER",
        purposeId: orderId,
        amountPaisa: 5_000,
        status: "PENDING",
        metaStr: JSON.stringify({ mode: "sandbox", idempotencyKey: header }),
      },
    });

    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "changed my mind" });
    expect(cancel.status).toBe(200);

    const voided = await prisma.payment.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(voided.status).toBe("FAILED");
    expect(voided.metaStr ?? "").toContain("order_cancelled");
    expect(voided.metaStr ?? "").toContain(header);

    const retry = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", header)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(legacy.id);
  });
});
