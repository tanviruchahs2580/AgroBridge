import { describe, expect, it, vi, afterEach } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { SSLCommerzProvider } from "../src/providers/payment/sslcommerz.js";
import { paymentMetaOf } from "../src/modules/payments/routes.js";

// Hoisted so the vi.mock factory (which runs during import hoisting, before
// any module-level const below) can close over the stub without a TDZ error.
const { verifyPaymentStub } = vi.hoisted(() => ({
  verifyPaymentStub: vi.fn<
    (
      providerRef: string,
      meta?: Record<string, unknown>
    ) => Promise<{ status: "SUCCEEDED" | "FAILED" | "PENDING"; amountPaisa?: number }>
  >(),
}));

vi.mock("../src/providers/payment/index.js", () => ({
  getPaymentProvider: () => ({
    name: "sslcommerz-stub",
    mode: "live" as const,
    // Intent creation must succeed so a PENDING live payment exists to
    // reconcile; the verdict is what the tests control.
    createPayment: async () => ({
      provider: "sslcommerz-stub",
      providerRef: "LIVE-STUB-REF",
      redirectUrl: "https://gw.example/pay",
      meta: { valId: "VAL-STUB" },
    }),
    verifyPayment: verifyPaymentStub,
  }),
  __esModule: true,
}));

/**
 * AUD-V3 (H-1/H-2): the live-gateway reconciliation paths must (a) send each
 * SSLCommerz API the key it actually resolves — val_id (from payment meta) to
 * the Validation API, our refNo/tran_id as orderNo to the Transaction Query
 * API — and (b) apply the webhook's own amount cross-check before any
 * PENDING→SUCCEEDED claim, so a verdict for the wrong value can never confirm
 * a payment. `globalThis.fetch` is stubbed for the adapter half; the route
 * half mocks getPaymentProvider with a controllable live provider.
 */

// ---------------------------------------------------------------------------
// Adapter half — real SSLCommerzProvider against a stubbed fetch
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function lastCallBody(): URLSearchParams {
  const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
  return new URLSearchParams(String(init.body));
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("SSLCommerz adapter key discipline", () => {
  it("createPayment returns the merchant refNo as providerRef and carries val_id in meta", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ GatewayPageURL: "https://gw.example/abc", sessionkey: "SESS-1", val_id: "VAL-777", tran_id: "PAY-REF-1" })
    );
    const provider = new SSLCommerzProvider();
    const intent = await provider.createPayment({
      amountPaisa: 15000,
      refNo: "PAY-REF-1",
      customerPhone: "01700000099",
      returnBaseUrl: "https://api.example",
    });
    expect(intent.providerRef).toBe("PAY-REF-1"); // tran_id, not the session key
    expect(intent.meta).toMatchObject({ valId: "VAL-777", sessionKey: "SESS-1" });
  });

  it("verifyPayment sends val_id (from meta) to the validator and rounds BDT to paisa exactly once", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "VALID", amount: "150.01" }));
    const provider = new SSLCommerzProvider();
    const verdict = await provider.verifyPayment("PAY-REF-2", { valId: "VAL-2" });
    expect(verdict).toEqual({ status: "SUCCEEDED", amountPaisa: 15001 });
    const sent = lastCallBody();
    expect(sent.get("val_id")).toBe("VAL-2");
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("validationserverAPI.php");
  });

  it("verifyPayment falls back to the query API with orderNo = our refNo (never the val_id)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("gateway down", { status: 502 })) // validator unreachable
      .mockResolvedValueOnce(jsonResponse({ status: "VALID", amount: "99.50" }));
    const provider = new SSLCommerzProvider();
    const verdict = await provider.verifyPayment("PAY-REF-3", { valId: "VAL-3" });
    expect(verdict).toEqual({ status: "SUCCEEDED", amountPaisa: 9950 });
    const sent = lastCallBody();
    expect(sent.get("orderNo")).toBe("PAY-REF-3");
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("/lp/txn/query");
  });

  it("a success verdict without a usable amount stays PENDING instead of confirming 0 paisa", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "VALID" })); // no amount field
    const provider = new SSLCommerzProvider();
    expect(await provider.verifyPayment("PAY-REF-4", { valId: "VAL-4" })).toEqual({ status: "PENDING" });
  });

  it("rounds float taka with Math.round (matching the webhook's paisa rule)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "VALIDATED", amount: "10.005" }));
    const provider = new SSLCommerzProvider();
    const verdict = await provider.verifyPayment("PAY-REF-5", { valId: "VAL-5" });
    expect(verdict).toEqual({ status: "SUCCEEDED", amountPaisa: Math.round(10.005 * 100) });
  });
});

describe("paymentMetaOf", () => {
  it("parses stored meta, tolerating null and corrupt JSON", () => {
    expect(paymentMetaOf(null)).toEqual({});
    expect(paymentMetaOf("not json")).toEqual({});
    expect(paymentMetaOf(JSON.stringify({ valId: "V" }))).toEqual({ valId: "V" });
    expect(paymentMetaOf("[1,2]")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Route half — GET /payments/:id/status against a controllable live provider
// ---------------------------------------------------------------------------

async function createPendingPayment(): Promise<{ paymentId: string; refNo: string; amountPaisa: number; token: string }> {
  const f = await registerFarmer();
  const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${f.accessToken}`);
  const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > 5);
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
    token: f.accessToken,
  };
}

describe("GET /payments/:id/status amount cross-check (live gateway)", () => {
  it("refuses a SUCCEEDED verdict whose amount does not match — payment stays PENDING, audited, reason reported", async () => {
    const { paymentId, amountPaisa, token } = await createPendingPayment();
    verifyPaymentStub.mockResolvedValueOnce({ status: "SUCCEEDED", amountPaisa: amountPaisa + 100 });

    const res = await request(app).get(`/api/v1/payments/${paymentId}/status`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.reconciled).toBe(false);
    expect(res.body.data.reason).toBe("amount_mismatch");
    expect(res.body.data.status).toBe("PENDING");

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
    expect(
      await prisma.auditLog.count({ where: { entityId: paymentId, action: "PAYMENT_RECONCILE_AMOUNT_MISMATCH" } })
    ).toBe(1);
    // The verdict must carry the payment's stored meta so a real adapter can
    // resolve its val_id: assert the stub received the parsed metaStr object.
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(verifyPaymentStub).toHaveBeenCalledWith(stored.providerRef ?? stored.refNo, paymentMetaOf(stored.metaStr));
  });

  it("refuses a SUCCEEDED verdict with a missing amount the same way", async () => {
    const { paymentId, token } = await createPendingPayment();
    verifyPaymentStub.mockResolvedValueOnce({ status: "SUCCEEDED" });

    const res = await request(app).get(`/api/v1/payments/${paymentId}/status`).set("Authorization", `Bearer ${token}`);
    expect(res.body.data.reason).toBe("amount_mismatch");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
  });

  it("a matching amount confirms the payment and the order", async () => {
    const { paymentId, amountPaisa, token } = await createPendingPayment();
    verifyPaymentStub.mockResolvedValueOnce({ status: "SUCCEEDED", amountPaisa });

    const res = await request(app).get(`/api/v1/payments/${paymentId}/status`).set("Authorization", `Bearer ${token}`);
    expect(res.body.data.reconciled).toBe(true);
    expect(res.body.data.status).toBe("SUCCEEDED");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("SUCCEEDED");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: payment.purposeId } });
    expect(order.paymentStatus).toBe("PAID");
  });

  it("a FAILED verdict fails the payment without an audit row", async () => {
    const { paymentId, token } = await createPendingPayment();
    verifyPaymentStub.mockResolvedValueOnce({ status: "FAILED" });

    const res = await request(app).get(`/api/v1/payments/${paymentId}/status`).set("Authorization", `Bearer ${token}`);
    expect(res.body.data.reconciled).toBe(false);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("FAILED");
    expect(await prisma.auditLog.count({ where: { entityId: paymentId, action: "PAYMENT_RECONCILE_AMOUNT_MISMATCH" } })).toBe(0);
  });
});
