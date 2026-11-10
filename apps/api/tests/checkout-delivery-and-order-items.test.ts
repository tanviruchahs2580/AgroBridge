import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * Checkout persists the delivery details the wizard validated, and order line
 * items carry the snapshot fields the history screen renders (the joined-product
 * read once crashed MyOrders when an order was expanded).
 *
 * Renamed/split from `round10-regressions` (F-92).
 */
describe("checkout delivery details and order line items", () => {
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
});
