import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sslcommerzSignature } from "../src/modules/payments/routes.js";
import { env } from "../src/config/env.js";

/**
 * E-04 residual: the sandbox `/confirm` path and the signed gateway webhook are
 * independent settlement paths that can arrive at the same instant (the buyer
 * returns while the IPN lands). Both funnel through a PENDING->SUCCEEDED claim,
 * so racing them must produce exactly ONE set of side effects: one transition,
 * one order flip, one notification, one audit row — the loser is a no-op.
 */
async function createOrderAndIntent(): Promise<{
  orderId: string;
  paymentId: string;
  refNo: string;
  amountPaisa: number;
  token: string;
}> {
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
    token: f.accessToken,
  };
}

describe("Sandbox confirm vs signed webhook — same payment race (E-04)", () => {
  it("exactly one side-effect set: one transition, one notification, one audit row", async () => {
    const { orderId, paymentId, refNo, amountPaisa, token } = await createOrderAndIntent();

    const params: Record<string, string> = {
      tran_id: refNo,
      val_id: "GW-RACE-VALID",
      status: "VALID",
      amount: (amountPaisa / 100).toFixed(2),
      currency: "BDT",
    };
    params.verify_key = "unused";
    params.verify_sign = sslcommerzSignature(params, env.SSLCOMMERZ_STORE_PASSWORD!);

    const [confirmRes, webhookRes] = await Promise.all([
      request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${token}`),
      request(app).post("/api/v1/payments/webhook/sslcommerz").type("form").send(params),
    ]);

    // Both paths answer without a server error; the loser is idempotent.
    expect(confirmRes.status).toBeLessThan(500);
    expect(webhookRes.status).toBeLessThan(500);
    expect([200, 409]).toContain(confirmRes.status);
    expect(webhookRes.status).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("SUCCEEDED");
    const meta = JSON.parse(payment.metaStr ?? "{}") as { sandbox?: boolean; mode?: string };
    // Exactly one winner's meta: sandbox confirm or the SSLCommerz webhook.
    expect(Boolean(meta.sandbox) !== (meta.mode === "sslcommerz")).toBe(true);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.paymentStatus).toBe("PAID");

    // One side-effect set only.
    expect(await prisma.payment.count({ where: { purposeId: orderId, status: "SUCCEEDED" } })).toBe(1);
    expect(
      await prisma.notification.count({ where: { type: "PAYMENT", refId: paymentId, category: "CRITICAL" } })
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: paymentId, action: { in: ["PAYMENT_SUCCEEDED", "PAYMENT_WEBHOOK_CONFIRMED"] } },
      })
    ).toBe(1);
  });
});
