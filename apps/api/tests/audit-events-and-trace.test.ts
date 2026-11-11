import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";

/**
 * The auditable server-side trail: failed logins and payment-intent creation
 * write audit rows, and W3C traceparent correlation surfaces as X-Trace-Id.
 *
 * Named for the behaviour it guards, not for the round that produced it (F-92).
 */
let admin: Awaited<ReturnType<typeof getAdmin>>;
beforeAll(async () => {
  admin = await getAdmin();
});

describe("audit events", () => {
  it("a failed login writes an AUTH_LOGIN_FAILED audit row with a reason", async () => {
    const f = await registerFarmer({ password: "RightPass@123" });
    await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "WrongPass@123" });

    const logs = await request(app)
      .get("/api/v1/admin/audit-logs?pageSize=20")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(logs.status).toBe(200);
    const row = (logs.body.data.items as { action: string }[]).find((r) => r.action === "AUTH_LOGIN_FAILED");
    expect(row, "failed login must be audit-logged").toBeTruthy();
  });

  it("payment intent creation writes a PAYMENT_INTENT_CREATED audit row", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    const products = await request(app).get("/api/v1/products?pageSize=1").set(auth);
    const productId = products.body.data.items[0].id as string;
    await request(app).post("/api/v1/cart/items").set(auth).send({ productId, qty: 1 });
    const checkout = await request(app).post("/api/v1/orders/checkout").set(auth).send({
      shippingName: f.user.fullName ?? "Buyer",
      shippingPhone: f.phone,
      shippingAddress: "Savar, Dhaka",
    });
    expect(checkout.status).toBe(201);

    const intent = await request(app).post("/api/v1/payments/intent").set(auth).send({
      purposeType: "ORDER",
      purposeId: checkout.body.data.id,
    });
    expect(intent.status).toBe(201);

    const logs = await request(app)
      .get("/api/v1/admin/audit-logs?pageSize=20")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const row = (logs.body.data.items as { action: string }[]).find((r) => r.action === "PAYMENT_INTENT_CREATED");
    expect(row, "payment intent must be audit-logged").toBeTruthy();
  });
});

describe("traceparent correlation (ARC-14)", () => {
  it("a valid traceparent is echoed as X-Trace-Id; an invalid one is ignored", async () => {
    const f = await registerFarmer();
    const good = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ok = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("traceparent", good);
    expect(ok.headers["x-trace-id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    // requestId still present: the two identifiers coexist
    expect(ok.headers["x-request-id"]).toBeTruthy();

    const bad = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("traceparent", "zz-not-a-trace");
    expect(bad.headers["x-trace-id"]).toBeUndefined();
    expect(bad.headers["x-request-id"]).toBeTruthy();
  });
});
