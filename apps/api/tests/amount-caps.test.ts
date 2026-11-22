import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUserWithRole } from "./helpers.js";

/**
 * QW-05 (DAT-02 immediate part): every single-amount input carries an explicit
 * Zod cap at MAX_SINGLE_AMOUNT_PAISA (2,000,000,000 — ৳20,000,000, safely
 * inside the int32 column the money schema uses). Without it, an oversized
 * integer sailed through validation and died inside Prisma/PostgreSQL as an
 * overflow 500; now it is a 400 with the cap named in the details. The
 * boundary itself (exactly the cap) stays schema-valid so legitimate big-ticket
 * prices keep working.
 */
const CAP = 2_000_000_000;

async function createProduct(pricePaisa: number) {
  const dealer = await createUserWithRole("DEALER");
  return request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${dealer.accessToken}`)
    .send({ sku: `SKU-${pricePaisa}`, name: "Boundary test product", category: "SEED", unit: "KG", pricePaisa, stockQty: 1 });
}

async function patchProduct(pricePaisa: number) {
  const dealer = await createUserWithRole("DEALER");
  const created = await request(app)
    .post("/api/v1/products")
    .set("Authorization", `Bearer ${dealer.accessToken}`)
    .send({ sku: `SKU-P-${pricePaisa}`, name: "Boundary patch product", category: "SEED", unit: "KG", pricePaisa: 1000, stockQty: 1 });
  expect(created.status).toBe(201);
  return request(app)
    .patch(`/api/v1/products/${created.body.data.id}`)
    .set("Authorization", `Bearer ${dealer.accessToken}`)
    .send({ pricePaisa });
}

async function createService(basePricePaisa: number) {
  // services:manage sits with the ADMIN tier (rbac.ts) — SERVICE_PROVIDER
  // executes bookings, it does not define service prices.
  const admin = await createUserWithRole("ADMIN");
  return request(app)
    .post("/api/v1/services")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ title: "Boundary test service", description: "Boundary", category: "SOIL_TEST", basePricePaisa });
}

async function requestWithdrawal(amountPaisa: number) {
  const farmer = await createUserWithRole("FARMER");
  return request(app)
    .post("/api/v1/wallet/withdrawals")
    .set("Authorization", `Bearer ${farmer.accessToken}`)
    .send({ amountPaisa, method: "BKASH", destination: "01712345678" });
}

describe("Single-amount Zod caps (MAX_SINGLE_AMOUNT_PAISA)", () => {
  it.each([
    ["POST /products pricePaisa", (v: number) => createProduct(v)],
    ["PATCH /products/:id pricePaisa", (v: number) => patchProduct(v)],
    ["POST /services basePricePaisa", (v: number) => createService(v)],
    ["POST /wallet/withdrawals amountPaisa", (v: number) => requestWithdrawal(v)],
  ])("accepts exactly the cap: $1", async (_name, call) => {
    const res = await call(CAP);
    // Schema-valid at the boundary: the route may still 400 for an unrelated
    // business reason (an empty wallet, for instance), but the amount itself
    // must never be the rejected field.
    expect(JSON.stringify(res.body.error?.details ?? [])).not.toMatch(/single-amount cap/);
    expect(res.status).toBeLessThan(500);
  });

  it.each([
    ["POST /products pricePaisa", (v: number) => createProduct(v)],
    ["PATCH /products/:id pricePaisa", (v: number) => patchProduct(v)],
    ["POST /services basePricePaisa", (v: number) => createService(v)],
    ["POST /wallet/withdrawals amountPaisa", (v: number) => requestWithdrawal(v)],
  ])("rejects cap+1 with the cap named: $1", async (_name, call) => {
    const res = await call(CAP + 1);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(JSON.stringify(res.body.error.details)).toMatch(/2,?000,?000,?000|amount/);
  });
});
