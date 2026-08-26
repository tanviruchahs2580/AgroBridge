import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sslcommerzSignature } from "../src/modules/payments/routes.js";
import { env } from "../src/config/env.js";

/** Creates an UNPAID confirmed order for the farmer and returns its id + total. */
async function createOrder(token: string): Promise<{ orderId: string; totalPaisa: number }> {
  const list = await request(app)
    .get("/api/v1/products?pageSize=50")
    .set("Authorization", `Bearer ${token}`);
  const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > 10);
  expect(product).toBeTruthy();
  await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: product.id, qty: 1 });
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(checkout.status).toBe(201);
  return { orderId: checkout.body.data.id as string, totalPaisa: checkout.body.data.totalPaisa as number };
}

async function orderStatus(orderId: string): Promise<{ status: string; paymentStatus: string }> {
  const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return { status: row.status, paymentStatus: row.paymentStatus };
}

function signedWebhookParams(params: Record<string, string>, verifySign?: string): Record<string, string> {
  return {
    ...params,
    verify_key: "unused",
    ...(verifySign === undefined ? { verify_sign: sslcommerzSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!) } : { verify_sign: verifySign }),
  };
}

async function postWebhook(body: Record<string, string>) {
  return request(app).post("/api/v1/payments/webhook/sslcommerz").type("form").send(body);
}

describe("Payments integrity — intent lifecycle", () => {
  it("creating a new intent cancels stale PENDING intents for the same purpose inside one transaction", async () => {
    const f = await registerFarmer();
    const { orderId } = await createOrder(f.accessToken);

    const first = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: orderId });
    expect(second.status).toBe(201);
    expect(second.body.data.paymentId).not.toBe(first.body.data.paymentId);

    // Exactly one live intent: the prior PENDING row was superseded -> FAILED.
    const stale = await prisma.payment.findUniqueOrThrow({ where: { id: first.body.data.paymentId } });
    expect(stale.status).toBe("FAILED");
    expect(stale.metaStr).toContain("superseded_by_new_intent");
    const live = await prisma.payment.findUniqueOrThrow({ where: { id: second.body.data.paymentId } });
    expect(live.status).toBe("PENDING");

    // Confirming the superseded intent can no longer move money.
    const zombieConfirm = await request(app).post(`/api/v1/payments/${stale.id}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(zombieConfirm.status).toBe(409);
  });

  it("double confirm returns conflict and applies side effects exactly once", async () => {
    const f = await registerFarmer();
    const { orderId } = await createOrder(f.accessToken);

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: orderId });
    const paymentId = intent.body.data.paymentId as string;

    const confirm1 = await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm1.status).toBe(200);
    expect(confirm1.body.data.status).toBe("SUCCEEDED");

    const confirm2 = await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm2.status).toBe(409);
    expect(confirm2.body.error.code).toBe("CONFLICT");

    // Side effects applied once: order PAID, no duplicate SUCCEEDED rows.
    expect(await orderStatus(orderId)).toEqual({ status: "PAID", paymentStatus: "PAID" });
    const succeeded = await prisma.payment.count({ where: { id: paymentId, status: "SUCCEEDED" } });
    expect(succeeded).toBe(1);
    const notifications = await prisma.notification.count({ where: { userId: f.user.id, type: "PAYMENT", refId: paymentId } });
    expect(notifications).toBeLessThanOrEqual(1);
  });
});

describe("Payments webhook — SSLCommerz IPN", () => {
  it("rejects an invalid signature without leaking payload internals", async () => {
    const res = await postWebhook(signedWebhookParams({ tran_id: "PAY-NOP", val_id: "V1", status: "VALID", amount: "100" }, "DEADBEEF000000000000000000000000"));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("accepts a valid signature but reports processed:false for non-VALID gateway status", async () => {
    const res = await postWebhook(
      signedWebhookParams({ tran_id: "PAY-20990101-UNKNOWNSTATUS", val_id: "V2", status: "FAILED", amount: "100" })
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.processed).toBe(false);
    expect(res.body.data.reason).toBe("status_FAILED");
  });

  it("returns 404 PAYMENT_NOT_FOUND for an unknown tran_id even with a valid signature", async () => {
    const res = await postWebhook(
      signedWebhookParams({ tran_id: "PAY-20990101-GHOSTTRAN", val_id: "V3", status: "VALID", amount: "100" })
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PAYMENT_NOT_FOUND");
    // Provider-facing endpoint answers with a minimal envelope (no internals echoed).
    expect(res.body.ok).toBe(false);
  });

  it("valid webhook flips PENDING→SUCCEEDED, applies order side effects, and replays are idempotent", async () => {
    const f = await registerFarmer();
    const { orderId } = await createOrder(f.accessToken);

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: orderId });
    const refNo = intent.body.data.refNo as string;
    expect(intent.body.data.providerMode).toBe("sandbox"); // sandbox confirm path stays available in test

    const params = signedWebhookParams({ tran_id: refNo, val_id: "GWVAL123", status: "VALID", amount: String(intent.body.data.amountPaisa) });
    const hit1 = await postWebhook(params);
    expect(hit1.status).toBe(200);
    expect(hit1.body.data.processed).toBe(true);

    const payment = await prisma.payment.findFirstOrThrow({ where: { refNo } });
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.metaStr).toContain('"verified":true');
    expect(await orderStatus(orderId)).toEqual({ status: "PAID", paymentStatus: "PAID" });

    // Replay of the same IPN must not double-apply side effects.
    const replay = await postWebhook(params);
    expect(replay.status).toBe(200);
    expect(replay.body.data.processed).toBe(false);
    expect(replay.body.data.reason).toBe("already_final");
    const succeededRows = await prisma.payment.count({ where: { refNo, status: "SUCCEEDED" } });
    expect(succeededRows).toBe(1);
  });
});

describe("Payments refunds — platform-initiated, orders only", () => {
  it("refunds a paid ORDER: REFUNDED status, compensating DEBIT ledger row, order refunded", async () => {
    const admin = (await import("./helpers.js")).getAdmin;
    const f = await registerFarmer();
    const { orderId } = await createOrder(f.accessToken);

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: orderId });
    const paymentId = intent.body.data.paymentId as string;
    const confirm = await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm.status).toBe(200);

    const walletBefore = await prisma.wallet.findUnique({ where: { userId: f.user.id } });
    const farmerRefund = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "self-service attempt" });
    expect(farmerRefund.status).toBe(403); // requires payments:refund

    const refund = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${(await admin()).accessToken}`)
      .send({ reason: "Product out of stock after payment" });
    expect(refund.status).toBe(200);
    expect(refund.body.data.status).toBe("REFUNDED");
    expect(refund.body.data.refundRef).toMatch(/^RFND-/);
    expect(refund.body.data.refundedAt).toBeTruthy();

    expect(await orderStatus(orderId)).toEqual({ status: "REFUNDED", paymentStatus: "REFUNDED" });

    const ledger = await prisma.walletTransaction.findFirstOrThrow({ where: { refType: "PAYMENT", refId: paymentId } });
    expect(ledger.direction).toBe("DEBIT");
    expect(ledger.amountPaisa).toBe(intent.body.data.amountPaisa);
    expect(ledger.balanceAfterPaisa).toBe((walletBefore?.balancePaisa ?? 0) - intent.body.data.amountPaisa);
  });

  it("second refund on the same payment conflicts instead of double-crediting", async () => {
    const { getAdmin } = await import("./helpers.js");
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();
    const { orderId } = await createOrder(f.accessToken);

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: orderId });
    const paymentId = intent.body.data.paymentId as string;
    await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);

    const first = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Customer changed mind" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Duplicate submission by support" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");

    const debitRows = await prisma.walletTransaction.count({ where: { refType: "PAYMENT", refId: paymentId, direction: "DEBIT" } });
    expect(debitRows).toBe(1); // compensated exactly once
  });

  it("membership purchases are rejected for refund with 422", async () => {
    const { getAdmin } = await import("./helpers.js");
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "MEMBERSHIP", purposeId: "SILVER" });
    expect(intent.status).toBe(201);
    const paymentId = intent.body.data.paymentId as string;
    const confirm = await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm.status).toBe(200);

    const refund = await request(app)
      .post(`/api/v1/payments/${paymentId}/refund`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Wants money back" });
    expect(refund.status).toBe(422);
    expect(refund.body.error.message).toMatch(/non-refundable/i);

    const stillActive = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(stillActive.status).toBe("SUCCEEDED");
  });
});
