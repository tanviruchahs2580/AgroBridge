import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sslcommerzSignature } from "../src/modules/payments/routes.js";
import { env } from "../src/config/env.js";

/**
 * PAY-01 (validator-authoritative settlement): the signed IPN proves a POST
 * came from the gateway, not that the transaction settled — the docs make the
 * Order Validation API mandatory for each transaction
 * (developer.sslcommerz.com/docs.html, retrieved 2026-11-22). The webhook now
 * settles a live-adapter payment only after a server-to-server `val_id`
 * validation that agrees on tran_id, amount, currency and shows no risk flag;
 * every other outcome stays PENDING and is answered non-processingly so the
 * gateway retries the IPN while reconciliation catches up.
 */
async function createOrderAndIntent(): Promise<{ paymentId: string; refNo: string; amountPaisa: number }> {
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
    paymentId: intent.body.data.paymentId as string,
    refNo: intent.body.data.refNo as string,
    amountPaisa: intent.body.data.amountPaisa as number,
  };
}

function signedWebhookParams(params: Record<string, string>): Record<string, string> {
  // Field set mirrors the documented IPN sample: the signature covers what
  // verify_key names, so these are the fields the gateway signs.
  const withKey = { ...params, verify_key: "tran_id,val_id,amount,currency,status,store_id,risk_level" };
  return { ...withKey, verify_sign: sslcommerzSignature(withKey, env.SSLCOMMERZ_STORE_PASSWORD!) };
}

async function postWebhook(body: Record<string, string>) {
  return request(app).post("/api/v1/payments/webhook/sslcommerz").type("form").send(body);
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe("Webhook settlement requires the Order Validation API", () => {
  const prevProvider = env.PAYMENT_PROVIDER;
  const prevStoreId = env.SSLCOMMERZ_STORE_ID;
  const prevSandbox = env.SSLCOMMERZ_SANDBOX;

  function activateSslcommerz() {
    env.PAYMENT_PROVIDER = "sslcommerz";
    env.SSLCOMMERZ_STORE_ID = "test-store-id";
    delete env.SSLCOMMERZ_SANDBOX;
  }
  function restore() {
    env.PAYMENT_PROVIDER = prevProvider;
    env.SSLCOMMERZ_STORE_ID = prevStoreId;
    if (prevSandbox === undefined) delete env.SSLCOMMERZ_SANDBOX;
    else env.SSLCOMMERZ_SANDBOX = prevSandbox;
  }

  it("settles after a VALID validator verdict that agrees on tran_id, amount and currency", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: "VALID",
          tran_id: refNo,
          amount: (amountPaisa / 100).toFixed(2),
          currency: "BDT",
          risk_level: 0,
          risk_title: "Safe",
        })
      );
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, val_id: "VAL-OK-1", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(true);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.status).toBe("SUCCEEDED");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1]!.body));
      expect(body.get("val_id")).toBe("VAL-OK-1");
      expect(body.get("store_id")).toBe("test-store-id");
      expect(body.get("store_passwd")).toBe(env.SSLCOMMERZ_STORE_PASSWORD);
    } finally {
      restore();
    }
  });

  it("settles a VALIDATED verdict (the documented replayed-validation status)", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "VALIDATED", tran_id: refNo, amount: (amountPaisa / 100).toFixed(2), currency: "BDT", risk_level: 0 }));
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, val_id: "VAL-REPLAYED", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(true);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("SUCCEEDED");
    } finally {
      restore();
    }
  });

  it("does not settle on an INVALID_TRANSACTION verdict and answers retryably", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "INVALID_TRANSACTION" }));
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, val_id: "VAL-INVALID", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(false);
      expect(res.body.data.reason).toBe("validator_invalid");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
    } finally {
      restore();
    }
  });

  it("does not settle when the validator is unreachable (5xx) and answers retryably", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValueOnce(new Response("boom", { status: 503 }));
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, val_id: "VAL-DOWN", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(false);
      expect(res.body.data.reason).toBe("validator_unavailable");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
    } finally {
      restore();
    }
  });

  it("does not settle when the validator verdict disagrees on the amount", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: "VALID", tran_id: refNo, amount: ((amountPaisa + 1000) / 100).toFixed(2), currency: "BDT", risk_level: 0 })
      );
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, val_id: "VAL-AMT", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(false);
      expect(res.body.data.reason).toBe("validator_amount_mismatch");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
    } finally {
      restore();
    }
  });

  it("does not settle when the validator verdict resolves a different tran_id", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "VALID", tran_id: "SOMEONE-ELSE", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", risk_level: 0 }));
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, val_id: "VAL-TXN", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(false);
      expect(res.body.data.reason).toBe("validator_tran_mismatch");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
    } finally {
      restore();
    }
  });

  it("does not settle a risk-flagged verdict (risk_level 1) — operator reconciliation path", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "VALID", tran_id: refNo, amount: (amountPaisa / 100).toFixed(2), currency: "BDT", risk_level: 1, risk_title: "Transaction flagged" }));
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, val_id: "VAL-RISK", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "1" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(false);
      expect(res.body.data.reason).toBe("gateway_risk_flag");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
    } finally {
      restore();
    }
  });

  it("does not settle when the IPN carries no val_id to validate", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      const res = await postWebhook(
        signedWebhookParams({ tran_id: refNo, amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
      );
      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(false);
      expect(res.body.data.reason).toBe("missing_val_id");
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
    } finally {
      restore();
    }
  });

  it("is idempotent on a replayed IPN with the same val_id once settled", async () => {
    activateSslcommerz();
    try {
      const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
      fetchMock.mockResolvedValue(jsonResponse({ status: "VALID", tran_id: refNo, amount: (amountPaisa / 100).toFixed(2), currency: "BDT", risk_level: 0 }));
      const params = signedWebhookParams({ tran_id: refNo, val_id: "VAL-SAME", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" });
      const first = await postWebhook(params);
      expect(first.body.data.processed).toBe(true);
      const second = await postWebhook(params);
      expect(second.status).toBe(200);
      expect(second.body.data.processed).toBe(false);
      expect(second.body.data.reason).toBe("already_final");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("SUCCEEDED");
    } finally {
      restore();
    }
  });

  it("leaves the sandbox-adapter path unchanged: no validation call, settlement proceeds on the existing checks", async () => {
    // The default test configuration activates the sandbox adapter, which does
    // not offer validateOrder — the webhook keeps its existing behaviour there.
    const { paymentId, refNo, amountPaisa } = await createOrderAndIntent();
    const res = await postWebhook(
      signedWebhookParams({ tran_id: refNo, val_id: "VAL-SANDBOX", amount: (amountPaisa / 100).toFixed(2), currency: "BDT", status: "VALID", store_id: "test-store-id", risk_level: "0" })
    );
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("SUCCEEDED");
  });
});
