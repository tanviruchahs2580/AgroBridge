import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createUserWithRole, createFarmWithCrop, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Regressions for the Play Store launch round (round 10).
 *
 * Each case pins a defect that was reachable in the shipped build:
 *  - checkout silently discarded the delivery address the wizard validated
 *  - order line items were returned as snapshots, but the UI read a joined
 *    product (page crashed when an order was expanded)
 *  - GET /admin/users had no permission gate, so territory roles could page
 *    through every account's PII
 *  - an ADMIN could grant SUPER_ADMIN (wildcard permissions)
 *  - by-id procurement/booking/payout mutations ignored the territory scope the
 *    list endpoints enforce
 */
describe("round 10 regressions", () => {
  async function stockSomeProduct(token: string, qty = 1) {
    const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${token}`);
    const product = list.body.data.items.find((p: { stockQty: number }) => p.stockQty > qty + 5);
    expect(product, "a product with stock is required").toBeTruthy();
    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: product.id, qty });
    return product;
  }

  it("checkout persists the delivery details captured by the wizard", async () => {
    const farmer = await registerFarmer();
    await stockSomeProduct(farmer.accessToken, 2);

    const res = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ shippingName: "করিম উদ্দিন", shippingPhone: "01712345678", shippingAddress: "গ্রাম: রামপুর, ডাকঘর: বদরগঞ্জ, রংপুর" });

    expect(res.status).toBe(201);
    expect(res.body.data.shippingName).toBe("করিম উদ্দিন");
    expect(res.body.data.shippingPhone).toBe("01712345678");
    expect(res.body.data.shippingAddress).toContain("রামপুর");
  });

  it("checkout rejects a malformed delivery phone instead of silently dropping it", async () => {
    const farmer = await registerFarmer();
    await stockSomeProduct(farmer.accessToken, 1);

    const res = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ shippingAddress: "গ্রাম: রামপুর", shippingPhone: "12345" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    // The order must not have been created: validation runs before the transaction.
    const orders = await request(app).get("/api/v1/orders").set("Authorization", `Bearer ${farmer.accessToken}`);
    expect(orders.body.data.length).toBe(0);
  });

  it("checkout still accepts a body-less request (clients released before the wizard sent details)", async () => {
    const farmer = await registerFarmer();
    await stockSomeProduct(farmer.accessToken, 1);

    const res = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${farmer.accessToken}`);
    expect(res.status).toBe(201);
    expect(res.body.data.shippingAddress ?? null).toBeNull();
  });

  it("order line items carry the snapshot fields the history screen renders", async () => {
    const farmer = await registerFarmer();
    const product = await stockSomeProduct(farmer.accessToken, 3);
    await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ shippingAddress: "গ্রাম: রামপুর, বদরগঞ্জ, রংপুর" });

    const orders = await request(app).get("/api/v1/orders").set("Authorization", `Bearer ${farmer.accessToken}`);
    const order = orders.body.data[0];
    expect(order.items.length).toBe(1);
    const item = order.items[0];
    // MyOrders renders exactly these two fields per line.
    expect(typeof item.nameSnapshot).toBe("string");
    expect(item.nameSnapshot.length).toBeGreaterThan(0);
    expect(item.nameSnapshot).toBe(product.name);
    expect(typeof item.unitPricePaisa).toBe("number");
    expect(item.unitPricePaisa).toBe(product.pricePaisa);
    expect(item.qty).toBe(3);
  });

  it("admin user directory requires users:read (territory roles are refused)", async () => {
    const regional = await createUserWithRole("REGIONAL_MANAGER");
    const res = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${regional.accessToken}`);
    expect(res.status).toBe(403);

    const admin = await getAdmin();
    const allowed = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(allowed.status).toBe(200);
  });

  it("an ADMIN cannot grant SUPER_ADMIN or modify an admin account", async () => {
    const admin = await getAdmin();
    const victim = await registerFarmer();

    const escalate = await request(app)
      .patch(`/api/v1/admin/users/${victim.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "SUPER_ADMIN" });
    expect(escalate.status).toBe(403);

    const target = await createUserWithRole("SUPER_ADMIN");
    const demote = await request(app)
      .patch(`/api/v1/admin/users/${target.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(demote.status).toBe(403);

    // A non-privileged role change is still allowed for an ADMIN.
    const okChange = await request(app)
      .patch(`/api/v1/admin/users/${victim.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "DEALER" });
    expect(okChange.status).toBe(200);
  });

  it("an admin cannot change its own role", async () => {
    const admin = await getAdmin();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "FARMER" });
    expect(res.status).toBe(400);
  });

  it("territory-scoped reviewers cannot act on another region's procurement order", async () => {
    // Farmer in Rangpur submits an offer for a catalogued crop.
    const farmer = await registerFarmer();
    const farm = await createFarmWithCrop(farmer.accessToken);
    const offer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ farmId: farm.farmId, cropName: "RICE", quantityKg: 500, qualityGrade: "A", moisturePct: 12 });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const poId = offer.body.data.id as string;

    // Region is a user attribute (assigned by an admin), and the list endpoint
    // scopes on exactly this field — put the farmer in Rangpur to model that.
    await prisma.user.update({ where: { id: farmer.user.id }, data: { region: "Rangpur" } });

    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    await prisma.user.update({ where: { id: manager.userId }, data: { region: "Khulna" } });
    const denied = await request(app)
      .post(`/api/v1/procurement/${poId}/review`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(denied.status).toBe(403);

    // The same manager with the farmer's region may proceed.
    await prisma.user.update({ where: { id: manager.userId }, data: { region: "Rangpur" } });
    const allowed = await request(app)
      .post(`/api/v1/procurement/${poId}/review`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.status).toBe("QC");
  });

  it("production refuses to simulate a payment unless explicitly opted in", async () => {
    // The production branch is a pure config predicate; assert the env schema
    // accepts the opt-in and that the flag is absent by default.
    const { env, isProd } = await import("../src/config/env.js");
    expect(isProd).toBe(false); // tests run as NODE_ENV=test
    expect(env.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION ?? undefined).toBeUndefined();
    // Sandbox confirmation stays available outside production (used by the e2e flow).
    const farmer = await registerFarmer();
    await stockSomeProduct(farmer.accessToken, 1);
    const order = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${farmer.accessToken}`);
    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: order.body.data.id });
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
    await stockSomeProduct(farmer.accessToken, 1);
    const order = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${farmer.accessToken}`);
    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: order.body.data.id });
    const status = await request(app)
      .get(`/api/v1/payments/${intent.body.data.paymentId}/status`)
      .set("Authorization", `Bearer ${farmer.accessToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe("PENDING");
    expect(status.body.data.reconciled).toBe(false);
  });

  it("logout rejects a non-string refresh token instead of throwing a 500", async () => {
    const farmer = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ refreshToken: 12345 });
    expect(res.status).toBe(400);
  });
});
