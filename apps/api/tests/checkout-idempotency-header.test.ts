import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * The Idempotency-Key header contract on money routes (ARC-10).
 *
 * Named for the behaviour it guards, not for the round that produced it (F-92).
 */
describe("Idempotency-Key header on checkout", () => {
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
