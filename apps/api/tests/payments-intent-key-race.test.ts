import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, getAdmin, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * F-03: two concurrent same-key intent creations could each create a payable
 * intent. The key used to live only inside `metaStr`, so the in-transaction
 * check was an unlocked `findMany` on a JSON substring and PostgreSQL's default
 * READ COMMITTED let both requests pass it; `Payment` had no key column and no
 * unique index as a backstop.
 *
 * Pinned here: `Payment.intentKey` + `@@unique([userId, intentKey])` exists and
 * enforces, a parallel same-key pair yields exactly ONE payment that both
 * callers are answered with, the API converts the loser's unique violation into
 * a replay rather than a 500, and a pre-2026-11-10 row carrying its key only in
 * metaStr still replays instead of creating a second intent.
 *
 * Honest scope: SQLite serialises writers, so the parallel case is a trivial
 * race locally. The index check (direct duplicate insert → P2002) is what
 * proves the backstop exists in this profile; the true READ COMMITTED race and
 * the resulting P2002-then-replay path are proven by the PostgreSQL profile in
 * CI (`npm run test:pg --workspace apps/api`).
 */

async function stockProduct(stockQty: number, qty: number, token: string): Promise<string> {
  const admin = await getAdmin();
  const res = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${admin.accessToken}`).send({
    sku: `IKR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "Intent key race item",
    category: "EQUIPMENT",
    unit: "PCS",
    pricePaisa: 5_000,
    stockQty,
  });
  expect(res.status).toBe(201);
  const added = await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${token}`).send({ productId: res.body.data.id, qty });
  expect(added.status).toBe(201);
  return res.body.data.id as string;
}

async function createOrder(token: string): Promise<string> {
  await stockProduct(10, 1, token);
  const checkout = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${token}`);
  expect(checkout.status).toBe(201);
  return checkout.body.data.id as string;
}

const key = () => `ik-race-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const ref = () => `PAY-PROBE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function send(token: string, orderId: string, k: string) {
  return request(app)
    .post("/api/v1/payments/intent")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", k)
    .send({ purposeType: "ORDER", purposeId: orderId });
}

describe("Payment intent — same-key concurrency backstop (F-03)", () => {
  it("parallel same-key requests produce exactly ONE payment, answered to both callers", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const k = key();

    const [a, b] = await Promise.all([send(f.accessToken, orderId, k), send(f.accessToken, orderId, k)]);
    const statuses = [a.status, b.status];
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(statuses.sort()).toEqual([200, 201]);

    expect(a.body.data.paymentId).toBe(b.body.data.paymentId);
    expect(a.body.data.refNo).toBe(b.body.data.refNo);
    expect(await prisma.payment.count({ where: { userId: f.user.id, intentKey: k } })).toBe(1);
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeId: orderId } })).toBe(1);
    // Exactly one live intent — the loser did not supersede or duplicate it.
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeId: orderId, status: "PENDING" } })).toBe(1);
  });

  it("the database backstop rejects a duplicate (userId, intentKey) even when the purpose differs", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const k = key();
    const created = await send(f.accessToken, orderId, k);
    expect(created.status).toBe(201);

    // Different purposeId, so only the (userId, intentKey) unique index can
    // reject this row — this is the constraint the race relies on.
    let code: string | null = null;
    try {
      await prisma.payment.create({
        data: {
          refNo: ref(),
          userId: f.user.id,
          purposeType: "ORDER",
          purposeId: `other-purpose-${Math.random().toString(36).slice(2, 8)}`,
          amountPaisa: 1_000,
          intentKey: k,
        },
      });
    } catch (e) {
      code = (e as { code?: string }).code ?? null;
    }
    expect(code).toBe("P2002");
    expect(await prisma.payment.count({ where: { userId: f.user.id, intentKey: k } })).toBe(1);
  });

  it("stores the key in the column AND keeps the metaStr shape older clients read", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const k = key();

    const created = await send(f.accessToken, orderId, k);
    expect(created.status).toBe(201);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: created.body.data.paymentId } });
    expect(row.intentKey).toBe(k);
    expect(row.metaStr ?? "").toContain(k);
  });

  it("a legacy row carrying its key only in metaStr replays instead of creating a second intent", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const k = key();

    // Simulate a pre-2026-11-10 row: key inside metaStr, no intentKey column value.
    const legacy = await prisma.payment.create({
      data: {
        refNo: ref(),
        userId: f.user.id,
        purposeType: "ORDER",
        purposeId: orderId,
        amountPaisa: 5_000,
        status: "PENDING",
        metaStr: JSON.stringify({ mode: "sandbox", idempotencyKey: k }),
      },
    });

    const replay = await send(f.accessToken, orderId, k);
    expect(replay.status).toBe(200);
    expect(replay.body.data.paymentId).toBe(legacy.id);
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeId: orderId } })).toBe(1);
  });

  it("the key survives confirmation, so a post-settlement retry still replays the same row", async () => {
    const f = await registerFarmer();
    const orderId = await createOrder(f.accessToken);
    const k = key();

    const created = await send(f.accessToken, orderId, k);
    expect(created.status).toBe(201);
    const paymentId = created.body.data.paymentId as string;

    const confirm = await request(app).post(`/api/v1/payments/${paymentId}/confirm`).set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe("SUCCEEDED");

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(row.intentKey).toBe(k);

    const retry = await send(f.accessToken, orderId, k);
    expect(retry.status).toBe(200);
    expect(retry.body.data.paymentId).toBe(paymentId);
    expect(await prisma.payment.count({ where: { userId: f.user.id, purposeId: orderId } })).toBe(1);
  });
});
