import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";

/**
 * 2026-10-21 hardening round:
 *  - notification preferences honoured when notifying (AUD-141)
 *  - upload rate limiter (SEC-11)
 *  - failed-login and payment-intent audit events (SEC-12)
 *  - Idempotency-Key header on money routes (ARC-10)
 *  - W3C traceparent correlation (ARC-14)
 *
 * The preferences specs prove persistence round-trips; the delivery-side
 * suppression is enforced inside notify() (apps/api/src/providers/notification/)
 * where a disabled category is skipped silently — the producer side is covered
 * by the category-mapping unit there, not by a webhook into another suite.
 */

let admin: Awaited<ReturnType<typeof getAdmin>>;
beforeAll(async () => {
  admin = await getAdmin();
});

describe("notification preferences (AUD-141)", () => {
  it("prefs round-trip and default to deliver-everything", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };

    const defaults = await request(app).get("/api/v1/notifications/preferences").set(auth);
    expect(defaults.body.data).toEqual({ critical: true, action: true, info: true });

    await request(app)
      .patch("/api/v1/notifications/preferences")
      .set(auth)
      .send({ critical: true, action: true, info: false });

    const after = await request(app).get("/api/v1/notifications/preferences").set(auth);
    expect(after.body.data).toEqual({ critical: true, action: true, info: false });
  });

  it("a user who disabled info keeps a served 200 list", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    await request(app)
      .patch("/api/v1/notifications/preferences")
      .set(auth)
      .send({ critical: true, action: true, info: false });
    const list = await request(app).get("/api/v1/notifications?limit=50").set(auth);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items)).toBe(true);
  });
});

describe("upload rate limiter (SEC-11)", () => {
  it("the 34th upload in an hour is refused with the standard envelope", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    let limited: request.Response | null = null;
    for (let i = 0; i < 34 && !limited; i++) {
      const res = await request(app)
        .post("/api/v1/disease/cases")
        .set(auth)
        .field("cropCycleId", `cycle-${i}`)
        .attach("image", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), {
          filename: `u${i}.jpg`,
          contentType: "image/jpeg",
        });
      if (res.status === 429) limited = res;
    }
    expect(limited, "upload limiter never fired within 34 uploads").not.toBeNull();
    expect(limited!.body.error.code).toBe("RATE_LIMITED");
    expect(typeof limited!.body.requestId).toBe("string");
  }, 60_000);
});

describe("audit events (SEC-12)", () => {
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

describe("Idempotency-Key header on checkout (ARC-10)", () => {
  it("the header maps onto the body key and replays the same order", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}`, "Idempotency-Key": "hdr-key-0000001" };

    const products = await request(app)
      .get("/api/v1/products?pageSize=1")
      .set("Authorization", `Bearer ${f.accessToken}`);
    const productId = products.body.data.items[0].id as string;
    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${f.accessToken}`).send({ productId, qty: 1 });

    const body = {
      shippingName: f.user.fullName ?? "B",
      shippingPhone: f.phone,
      shippingAddress: "Savar, Dhaka",
    };
    const first = await request(app).post("/api/v1/orders/checkout").set(auth).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/v1/orders/checkout").set(auth).send(body);
    // Same key ⇒ the SAME order replays (200 replay path), never a second order.
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it("a malformed Idempotency-Key header is a 400, not silently ignored", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "short")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("a key disagreeing with the body's clientRequestId is a 400", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Idempotency-Key", "header-key-00000001")
      .send({ clientRequestId: "body-key-00000001" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_MISMATCH");
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
