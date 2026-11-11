import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";

/**
 * F-04 + F-05: the SSLCommerz session request.
 *
 * F-04 — the return URLs were built from `apiPublicBaseUrl()` without the
 * `/api/v1` mount prefix, while `API_PUBLIC_URL` is documented in three places
 * as the API's public base WITHOUT that prefix. With the documented
 * configuration the buyer returning from hosted checkout hit a 404 instead of
 * the 303 back to the web app.
 * F-05 — the session body omitted `notify_url` (the IPN target: the ONLY path
 * that confirms real money) and the v4 customer/product fields, which
 * SSLCommerz expects before it issues a `GatewayPageURL`.
 *
 * These tests drive the REAL adapter through the real route with
 * `globalThis.fetch` stubbed, and pin the exact form fields. They cannot prove
 * the live gateway accepts the session — no credentials and no outbound calls
 * here. A sandbox rehearsal against sandbox.sslcommerz.com is still required
 * before live mode is enabled.
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

async function orderIdFor(token: string): Promise<string> {
  const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${token}`);
  const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > 5);
  expect(product, "a product with stock is required").toBeTruthy();
  await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: product.id, qty: 1 });
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(checkout.status).toBe(201);
  return checkout.body.data.id as string;
}

function lastCall(): [string | URL | Request, RequestInit | undefined] {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("no fetch call captured");
  return call;
}

function lastCallBody(): URLSearchParams {
  return new URLSearchParams(String(lastCall()[1]?.body ?? ""));
}

async function withLiveGateway<T>(publicUrl: string | undefined, run: () => Promise<T>): Promise<T> {
  const prev = {
    provider: env.PAYMENT_PROVIDER,
    storeId: env.SSLCOMMERZ_STORE_ID,
    sandbox: env.SSLCOMMERZ_SANDBOX,
    publicUrl: env.API_PUBLIC_URL,
  };
  try {
    env.PAYMENT_PROVIDER = "sslcommerz";
    env.SSLCOMMERZ_STORE_ID = "test-store-id";
    // The live host is selected by the explicit flag, not credentials alone.
    env.SSLCOMMERZ_SANDBOX = "false";
    env.API_PUBLIC_URL = publicUrl;
    return await run();
  } finally {
    env.PAYMENT_PROVIDER = prev.provider;
    env.SSLCOMMERZ_STORE_ID = prev.storeId;
    env.SSLCOMMERZ_SANDBOX = prev.sandbox;
    env.API_PUBLIC_URL = prev.publicUrl;
  }
}

describe("SSLCommerz session request — callback prefix and v4 fields (F-04/F-05)", () => {
  it("builds /api/v1 callbacks from the documented API_PUBLIC_URL and sends notify_url + v4 customer/product fields", async () => {
    const f = await registerFarmer();
    const orderId = await orderIdFor(f.accessToken);

    const intent = await withLiveGateway("https://api.example.test", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ GatewayPageURL: "https://gw.example/pay", sessionkey: "SESS-1", val_id: "VAL-1", tran_id: "T-1" })
      );
      const res = await request(app)
        .post("/api/v1/payments/intent")
        .set("Authorization", `Bearer ${f.accessToken}`)
        .send({ purposeType: "ORDER", purposeId: orderId });
      expect(res.status).toBe(201);
      expect(res.body.data.redirectUrl).toBe("https://gw.example/pay");
      return res;
    });

    const sentTo = String(lastCall()[0]);
    expect(sentTo).toBe("https://securepay.sslcommerz.com/gwprocess/v4/api.php");

    const body = lastCallBody();
    // F-04: the documented API_PUBLIC_URL form (no /api/v1) must still produce
    // the mounted callback path the app actually serves.
    expect(body.get("success_url")).toBe("https://api.example.test/api/v1/payments/gateway/return/success");
    expect(body.get("fail_url")).toBe("https://api.example.test/api/v1/payments/gateway/return/fail");
    expect(body.get("cancel_url")).toBe("https://api.example.test/api/v1/payments/gateway/return/cancel");
    // The callback path must exist in this app — proving the prefix is the
    // right one, not just present.
    const probe = await request(app).get("/api/v1/payments/gateway/return/success").redirects(0);
    expect(probe.status).toBe(303);

    // F-05: the IPN target.
    expect(body.get("notify_url")).toBe("https://api.example.test/api/v1/payments/webhook/sslcommerz");

    // F-05: the v4 customer/product fields.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(body.get("cus_name")).toBe(user.fullName);
    expect(body.get("cus_phone")).toBe(user.phone);
    expect(body.get("cus_add1")).toBeTruthy();
    expect(body.get("cus_city")).toBeTruthy();
    expect(body.get("cus_country")).toBe("Bangladesh");
    expect(body.get("product_name")).toBeTruthy();
    expect(body.get("product_profile")).toBeTruthy();

    // The pre-existing fields are unchanged.
    expect(body.get("tran_id")).toBe(intent.body.data.refNo);
    expect(body.get("total_amount")).toBe((intent.body.data.amountPaisa / 100).toFixed(2));
    expect(body.get("currency")).toBe("BDT");
    expect(body.get("store_id")).toBe("test-store-id");
    expect(body.get("product_category")).toBe("general");
    expect(body.get("shipping_method")).toBe("NO");
    expect(body.get("num_of_item")).toBe("1");
  });

  it("falls back to the request host plus /api/v1 when API_PUBLIC_URL is unset", async () => {
    const f = await registerFarmer();
    const orderId = await orderIdFor(f.accessToken);

    await withLiveGateway(undefined, async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ GatewayPageURL: "https://gw.example/pay" }));
      const res = await request(app)
        .post("/api/v1/payments/intent")
        .set("Authorization", `Bearer ${f.accessToken}`)
        .send({ purposeType: "ORDER", purposeId: orderId });
      expect(res.status).toBe(201);
    });

    const body = lastCallBody();
    expect(body.get("success_url")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/payments\/gateway\/return\/success$/);
    expect(body.get("notify_url")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/payments\/webhook\/sslcommerz$/);
  });
});
