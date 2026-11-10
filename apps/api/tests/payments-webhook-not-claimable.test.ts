import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sslcommerzSignature } from "../src/modules/payments/routes.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/lib/logger.js";
import { registry } from "../src/lib/metrics.js";

/**
 * F-24: a captured gateway payment the webhook cannot apply used to be answered
 * 200 `{processed:false, reason:"not_claimable"}` with no audit row, no counter
 * and no log. The money is at the gateway, the Payment row is FAILED/REFUNDED,
 * and no other detector looks at gateway payments — nobody was told.
 *
 * Pinned here: the escalation exists on all three channels (audit trail,
 * `PaymentFailures` series, structured warn log) and carries only tender
 * references, never the payload.
 */

/** The store password the IPN signature is computed with (set in tests/setup-env.ts). */
function storePassword(): string {
  const value = env.SSLCOMMERZ_STORE_PASSWORD;
  if (!value) throw new Error("SSLCOMMERZ_STORE_PASSWORD must be set for tests (tests/setup-env.ts)");
  return value;
}

function signedWebhookParams(params: Record<string, string>): Record<string, string> {
  return { ...params, verify_key: "unused", verify_sign: sslcommerzSignature(params, storePassword()) };
}

async function metricValues(counterName: string): Promise<{ labels: Record<string, string>; value: number }[]> {
  const json = (await registry.getMetricsAsJSON()) as { name: string; values: { labels: Record<string, string>; value: number }[] }[];
  return json.find((m) => m.name === counterName)?.values ?? [];
}

async function notClaimableValue(): Promise<number> {
  const values = await metricValues("agrobridge_payment_intents_total");
  return values.find((v) => v.labels.purpose_type === "ORDER" && v.labels.status === "webhook_not_claimable")?.value ?? 0;
}

async function orderIdFor(token: string): Promise<string> {
  const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${token}`);
  const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > 5);
  expect(product, "a product with stock is required").toBeTruthy();
  await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: product.id, qty: 1 });
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(checkout.status).toBe(201);
  return checkout.body.data.id as string;
}

async function intentFor(token: string, orderId: string) {
  const res = await request(app)
    .post("/api/v1/payments/intent")
    .set("Authorization", `Bearer ${token}`)
    .send({ purposeType: "ORDER", purposeId: orderId });
  expect(res.status).toBe(201);
  return res.body.data as { paymentId: string; refNo: string; amountPaisa: number };
}

const warnSpy = vi.spyOn(logger, "warn");
afterEach(() => {
  warnSpy.mockClear();
});

describe("Webhook — a captured payment that cannot be claimed is escalated (F-24)", () => {
  it("audits, counts and warns instead of swallowing the money", async () => {
    const f = await registerFarmer();
    const orderId = await orderIdFor(f.accessToken);

    // Two intents for one order: the second supersedes the first (FAILED), so a
    // gateway confirmation for the FIRST session — money captured against a
    // dead intent — is exactly the not_claimable case.
    const stale = await intentFor(f.accessToken, orderId);
    const live = await intentFor(f.accessToken, orderId);
    expect(live.paymentId).not.toBe(stale.paymentId);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: stale.paymentId } })).status).toBe("FAILED");

    const before = await notClaimableValue();
    const hit = await request(app)
      .post("/api/v1/payments/webhook/sslcommerz")
      .type("form")
      .send(
        signedWebhookParams({
          tran_id: stale.refNo,
          val_id: "GW-NOT-CLAIMABLE",
          status: "VALID",
          amount: (stale.amountPaisa / 100).toFixed(2),
          currency: "BDT",
        })
      );

    // The gateway still gets its acknowledgement.
    expect(hit.status).toBe(200);
    expect(hit.body.data.processed).toBe(false);
    expect(hit.body.data.reason).toBe("not_claimable");

    // 1. Audit trail: an actor-less row naming the tender reference.
    const auditRows = await prisma.auditLog.findMany({
      where: { action: "PAYMENT_NOT_CLAIMABLE", entityId: stale.paymentId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.entityType).toBe("Payment");
    expect(auditRows[0]?.metaStr ?? "").toContain(stale.refNo);
    expect(auditRows[0]?.metaStr ?? "").toContain(String(stale.amountPaisa));

    // 2. The PaymentFailures series fires (the counter never incremented for
    // this branch before the fix).
    expect(await notClaimableValue()).toBe(before + 1);

    // 3. A structured warn log with tender references only — never the payload.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnCall = warnSpy.mock.calls[0] as unknown as [Record<string, unknown>, string] | undefined;
    expect(warnCall).toBeTruthy();
    const [logged, message] = warnCall ?? [{}, ""];
    expect(String(message)).toMatch(/not claimable/i);
    expect(logged.tranId).toBe(stale.refNo);
    expect(logged.paymentId).toBe(stale.paymentId);
    expect(logged.paymentStatus).toBe("FAILED");
    expect(logged).not.toHaveProperty("verify_sign");
    expect(logged).not.toHaveProperty("store_passwd");

    // Nothing was settled or notified: the stale intent stays terminal, the
    // order stays unpaid, and no success notification exists for it.
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: stale.paymentId } })).status).toBe("FAILED");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).not.toBe("PAID");
    expect(await prisma.notification.count({ where: { type: "PAYMENT", refId: stale.paymentId } })).toBe(0);
    // The live (second) intent is untouched by the stale session's webhook.
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: live.paymentId } })).status).toBe("PENDING");
  });

  it("a replay of the same not-claimable IPN is still acknowledged, and the audit is written per delivery", async () => {
    const f = await registerFarmer();
    const orderId = await orderIdFor(f.accessToken);
    const stale = await intentFor(f.accessToken, orderId);
    await intentFor(f.accessToken, orderId); // supersede

    const payload = signedWebhookParams({
      tran_id: stale.refNo,
      val_id: "GW-NOT-CLAIMABLE-REPLAY",
      status: "VALID",
      amount: (stale.amountPaisa / 100).toFixed(2),
      currency: "BDT",
    });
    for (let i = 0; i < 2; i++) {
      const hit = await request(app).post("/api/v1/payments/webhook/sslcommerz").type("form").send(payload);
      expect(hit.status).toBe(200);
      expect(hit.body.data.processed).toBe(false);
    }
    // Each delivery is a distinct escalation: the gateway retries until it gets
    // its ack, and an operator wants to see how often money was left unclaimed.
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_NOT_CLAIMABLE", entityId: stale.paymentId } })).toBe(2);
  });
});
