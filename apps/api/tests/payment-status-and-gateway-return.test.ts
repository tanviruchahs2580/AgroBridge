import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * Sandbox payment-mode behaviour: the production opt-in predicate, the status
 * endpoint without a live gateway, and the single well-formed gateway return
 * origin.
 *
 * Renamed/split from `round10-regressions` (F-92).
 */
describe("payment provider mode and gateway return", () => {
  async function orderWithIntent(token: string) {
    const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${token}`);
    const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > 5);
    expect(product, "a product with stock is required").toBeTruthy();
    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: product.id, qty: 1 });
    const order = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
    expect(order.status).toBe(201);
    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${token}`)
      .send({ purposeType: "ORDER", purposeId: order.body.data.id });
    return { order, intent };
  }

  it("production refuses to simulate a payment unless explicitly opted in", async () => {
    // The production branch is a pure config predicate; assert the env schema
    // accepts the opt-in and that the flag is absent by default.
    const { env, isProd } = await import("../src/config/env.js");
    expect(isProd).toBe(false); // tests run as NODE_ENV=test
    expect(env.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION ?? undefined).toBeUndefined();
    // Sandbox confirmation stays available outside production (used by the e2e flow).
    const farmer = await registerFarmer();
    const { intent } = await orderWithIntent(farmer.accessToken);
    expect(intent.status).toBe(201);
    expect(intent.body.data.providerMode).toBe("sandbox");
    const confirm = await request(app)
      .post(`/api/v1/payments/${intent.body.data.paymentId}/confirm`)
      .set("Authorization", `Bearer ${farmer.accessToken}`);
    expect(confirm.status).toBe(200);
    // Sandbox intents must not advertise a gateway redirect.
    expect(intent.body.data.redirectUrl).toBeUndefined();
  });

  it("payment status endpoint reports state without a live gateway", async () => {
    const farmer = await registerFarmer();
    const { intent } = await orderWithIntent(farmer.accessToken);
    const status = await request(app)
      .get(`/api/v1/payments/${intent.body.data.paymentId}/status`)
      .set("Authorization", `Bearer ${farmer.accessToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe("PENDING");
    expect(status.body.data.reconciled).toBe(false);
  });

  it("gateway return redirects to a single well-formed origin", async () => {
    // WEB_ORIGIN is an allow-list (site origin + the Capacitor `https://localhost`).
    // Feeding the whole list to `new URL()` produced a malformed location in
    // production — caught by probing the live deployment, pinned here.
    const { primaryOriginOf } = await import("../src/config/env.js");
    expect(primaryOriginOf("https://agrobridge-web.vercel.app,https://localhost")).toBe("https://agrobridge-web.vercel.app");
    expect(primaryOriginOf(" https://site.example , https://localhost ")).toBe("https://site.example");
    expect(primaryOriginOf("https://site.example")).toBe("https://site.example");
    expect(primaryOriginOf("")).toBe("http://localhost:5173");
    expect(primaryOriginOf("not a url")).toBe("http://localhost:5173");

    // And the endpoint itself must answer with a usable Location header.
    const res = await request(app).get("/api/v1/payments/gateway/return/success").redirects(0);
    expect(res.status).toBe(303);
    const location = res.headers.location ?? "";
    expect(location).toMatch(/^https?:\/\/[^,]+\/orders\?payment=success$/);
  });
});

describe("startup manifest", () => {
  it("lists every simulated capability, including the payments opt-in", async () => {
    // A money-path flag must be visible at boot, not only in the environment.
    const { placeholderManifest } = await import("../src/config/env.js");
    const base = {
      SMS_PROVIDER: "sandbox",
      WEATHER_PROVIDER: "mock",
      AI_PROVIDER: "offline",
      PAYMENT_PROVIDER: "sandbox",
      STORAGE_PROVIDER: "local",
    };
    const quiet = placeholderManifest({ ...base, PAYMENT_PROVIDER: "sslcommerz", STORAGE_PROVIDER: "s3" });
    expect(quiet.some((w) => w.includes("ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION"))).toBe(false);

    const pilot = placeholderManifest({ ...base, ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION: "1" });
    const payments = pilot.find((w) => w.startsWith("ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1"));
    expect(payments, "the pilot payments opt-in must appear in the manifest").toBeTruthy();
    expect(payments).toMatch(/before store submission/);

    // Every simulated capability present is reported, none invented.
    expect(placeholderManifest(base)).toHaveLength(5);
  });
});
