import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, getAdmin, registerFarmer, createUserWithRole } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * F-63(c): `isActive` was never written anywhere in `src` — every occurrence was
 * a `where: { isActive: true }` filter — so the flag was permanently true and a
 * mispriced product could never be corrected, nor a withdrawn one retired,
 * through the API. `PATCH /products/:id` is the lifecycle route that closes it.
 */
async function createProduct(adminToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      sku: `LC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Lifecycle item",
      category: "SEED",
      unit: "KG",
      pricePaisa: 12_500,
      stockQty: 20,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; sku: string; pricePaisa: number; isActive: boolean };
}

describe("F-63c: product lifecycle via PATCH /products/:id", () => {
  it("a mispriced product can be corrected (integer paisa) and the change is audited", async () => {
    const admin = await getAdmin();
    const product = await createProduct(admin.accessToken);

    const patch = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ pricePaisa: 9_900 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.pricePaisa).toBe(9_900);
    expect(Number.isInteger(patch.body.data.pricePaisa)).toBe(true);
    // Omitted fields stay unchanged.
    expect(patch.body.data.name).toBe("Lifecycle item");
    expect(patch.body.data.stockQty).toBe(20);

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "PRODUCT_UPDATE", entityId: product.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).toBeTruthy();
  });

  it("a product can be retired (isActive=false): gone from the catalogue and from new carts", async () => {
    const admin = await getAdmin();
    const farmer = await registerFarmer();
    const product = await createProduct(admin.accessToken, { stockQty: 5 });

    // Visible and addable before retirement.
    const before = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${farmer.accessToken}`);
    expect((before.body.data.items as { id: string }[]).some((p) => p.id === product.id)).toBe(true);

    const retire = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(retire.status).toBe(200);
    expect(retire.body.data.isActive).toBe(false);

    const after = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${farmer.accessToken}`);
    expect((after.body.data.items as { id: string }[]).some((p) => p.id === product.id)).toBe(false);

    // The checkout-side guard is real: adding a retired product to a cart fails.
    const cart = await request(app)
      .post("/api/v1/cart/items")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ productId: product.id, qty: 1 });
    expect(cart.status).toBe(404);
  });

  it("reactivating restores the product", async () => {
    const admin = await getAdmin();
    await createProduct(admin.accessToken, { sku: `LC-ON-${Date.now()}` });
    const retired = await createProduct(admin.accessToken, { sku: `LC-OFF-${Date.now()}` });

    await request(app).patch(`/api/v1/products/${retired.id}`).set("Authorization", `Bearer ${admin.accessToken}`).send({ isActive: false });
    const back = await request(app).patch(`/api/v1/products/${retired.id}`).set("Authorization", `Bearer ${admin.accessToken}`).send({ isActive: true });
    expect(back.status).toBe(200);
    expect(back.body.data.isActive).toBe(true);
  });

  it("DEALER (products:manage) may edit; a FARMER may not; an unknown id is 404", async () => {
    const admin = await getAdmin();
    const product = await createProduct(admin.accessToken);
    const dealer = await createUserWithRole("DEALER");
    const farmer = await registerFarmer();

    const asDealer = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${dealer.accessToken}`)
      .send({ pricePaisa: 10_100 });
    expect(asDealer.status).toBe(200);

    const asFarmer = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ pricePaisa: 1 });
    expect(asFarmer.status).toBe(403);

    const anon = await request(app).patch(`/api/v1/products/${product.id}`).send({ pricePaisa: 1 });
    expect(anon.status).toBe(401);

    const missing = await request(app)
      .patch("/api/v1/products/does-not-exist")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ pricePaisa: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("an empty patch and a non-integer price are refused (no silent no-op, no float money)", async () => {
    const admin = await getAdmin();
    const product = await createProduct(admin.accessToken);

    const empty = await request(app).patch(`/api/v1/products/${product.id}`).set("Authorization", `Bearer ${admin.accessToken}`).send({});
    expect(empty.status).toBe(400);

    const floatPrice = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ pricePaisa: 12.5 });
    expect(floatPrice.status).toBe(400);

    const negative = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ pricePaisa: -100 });
    expect(negative.status).toBe(400);
  });
});
