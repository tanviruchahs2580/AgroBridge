import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sslcommerzSignature } from "../src/modules/payments/routes.js";
import { env } from "../src/config/env.js";

/**
 * AUD-104 (S2): the webhook verified the signature, gateway status and refNo,
 * but never the gateway's amount — a signed IPN for a different charge (or a
 * misconfigured store) could confirm a payment for the wrong value. The amount
 * must agree with payment.amountPaisa (BDT → paisa, rounded) and any currency
 * present must be BDT; a mismatch leaves the payment PENDING for reconciliation.
 */
async function createOrderAndIntent(): Promise<{ orderId: string; paymentId: string; refNo: string; amountPaisa: number }> {
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
  return {
    orderId: checkout.body.data.id as string,
    paymentId: intent.body.data.paymentId as string,
    refNo: intent.body.data.refNo as string,
    amountPaisa: intent.body.data.amountPaisa as number,
  };
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

async function paymentStatus(paymentId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: payment.purposeId } });
  return { payment: payment.status, order: order.status, orderPayment: order.paymentStatus };
}

describe("Webhook gateway amount verification", () => {
  it("rejects a wrong amount with 400 and leaves the payment PENDING", async () => {
    const { paymentId, refNo, amountPaisa, orderId } = await createOrderAndIntent();

    const wrongBdt = ((amountPaisa + 100) / 100).toFixed(2); // one taka too much
    const res = await postWebhook(signedWebhookParams({ tran_id: refNo, val_id: "GW-WRONG", status: "VALID", amount: wrongBdt, currency: "BDT" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");

    expect(await paymentStatus(paymentId)).toEqual({ payment: "PENDING", order: "CONFIRMED", orderPayment: "UNPAID" });
    expect(await prisma.payment.count({ where: { purposeId: orderId, status: "SUCCEEDED" } })).toBe(0);
  });

  it("rejects a missing amount with 400 and leaves the payment PENDING", async () => {
    const { paymentId, refNo } = await createOrderAndIntent();

    const res = await postWebhook(signedWebhookParams({ tran_id: refNo, val_id: "GW-NOAMOUNT", status: "VALID", currency: "BDT" }));
    expect(res.status).toBe(400);

    const state = await paymentStatus(paymentId);
    expect(state.payment).toBe("PENDING");
    expect(state.order).toBe("CONFIRMED");
  });

  it("rejects a non-numeric amount and a non-BDT currency", async () => {
    const { refNo: refA, paymentId: paymentA } = await createOrderAndIntent();
    const nonNumeric = await postWebhook(signedWebhookParams({ tran_id: refA, val_id: "GW-NAN", status: "VALID", amount: "NaN-ish", currency: "BDT" }));
    expect(nonNumeric.status).toBe(400);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentA } })).status).toBe("PENDING");

    const { refNo: refB, amountPaisa: amountB, paymentId: paymentB } = await createOrderAndIntent();
    const wrongCurrency = await postWebhook(
      signedWebhookParams({ tran_id: refB, val_id: "GW-USD", status: "VALID", amount: (amountB / 100).toFixed(2), currency: "USD" })
    );
    expect(wrongCurrency.status).toBe(400);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentB } })).status).toBe("PENDING");
  });

  it("a correct amount (BDT with decimals) still confirms the payment", async () => {
    const { orderId, paymentId, refNo, amountPaisa } = await createOrderAndIntent();

    const res = await postWebhook(
      signedWebhookParams({ tran_id: refNo, val_id: "GW-OK", status: "VALID", amount: (amountPaisa / 100).toFixed(2), currency: "BDT" })
    );
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(true);
    expect(await paymentStatus(paymentId)).toEqual({ payment: "SUCCEEDED", order: "PAID", orderPayment: "PAID" });
    expect(orderId).toBeTruthy();
  });
});
