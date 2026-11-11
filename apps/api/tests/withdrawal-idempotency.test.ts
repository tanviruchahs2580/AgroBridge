import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * F-01: `POST /wallet/withdrawals` had no idempotency mechanism of any kind —
 * no key column, no header mapper, no lookup. A withdraw request whose response
 * is lost (or double-tapped) created a second Withdrawal row and a second hold;
 * finance approving both pays real money twice. The only previous guard was the
 * available-balance check, which bounds a duplicate at the balance rather than
 * preventing it.
 *
 * Pinned here: the `Idempotency-Key` header and the body `clientRequestId` both
 * land in the same key column, a repeat replays the ORIGINAL row with 200 and
 * reserves no second hold, a malformed or mismatching key is a 400 rather than
 * silently ignored, keys are scoped per user, and a refused attempt does not
 * poison its key.
 *
 * Concurrency note: SQLite serialises writers, so the parallel case below is a
 * trivial race locally; the `@@unique([userId, clientRequestId])` index is the
 * backstop that PostgreSQL's READ COMMITTED needs, and the unique-violation
 * path is exercised here at the API level all the same (the second request is
 * converted into a replay). The PostgreSQL profile is the one that proves the
 * true race.
 */

async function seedBalance(userId: string, balancePaisa: number) {
  await prisma.wallet.upsert({
    where: { userId },
    update: { balancePaisa: { increment: balancePaisa } },
    create: { userId, balancePaisa },
  });
}

const key = () => `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function post(token: string, body: Record<string, unknown>, headerKey?: string) {
  const req = request(app).post("/api/v1/wallet/withdrawals").set("Authorization", `Bearer ${token}`);
  return headerKey ? req.set("Idempotency-Key", headerKey).send(body) : req.send(body);
}

async function heldPaisa(userId: string): Promise<number> {
  return (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).heldPaisa;
}

describe("Withdrawal idempotency — Idempotency-Key header (F-01)", () => {
  it("same header twice: 201 then a 200 replay of the SAME withdrawal, one hold", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000);
    const k = key();

    const first = await post(f.accessToken, { amountPaisa: 20_000, channel: "BKASH" }, k);
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe("PENDING");

    const retry = await post(f.accessToken, { amountPaisa: 20_000, channel: "BKASH" }, k);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.refNo).toBe(first.body.data.refNo);

    expect(await prisma.withdrawal.count({ where: { userId: f.user.id, clientRequestId: k } })).toBe(1);
    // Reserved exactly once — the replay must not hold the amount again.
    expect(await heldPaisa(f.user.id)).toBe(20_000);
  });

  it("the body clientRequestId channel (what the shipped web client sends) uses the same key contract", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000);
    const k = key();

    const first = await post(f.accessToken, { amountPaisa: 15_000, channel: "NAGAD", clientRequestId: k });
    expect(first.status).toBe(201);
    expect(first.body.data.clientRequestId).toBe(k);

    const retry = await post(f.accessToken, { amountPaisa: 15_000, channel: "NAGAD", clientRequestId: k });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id, clientRequestId: k } })).toBe(1);
    expect(await heldPaisa(f.user.id)).toBe(15_000);
  });

  it("a header disagreeing with the body's clientRequestId is a 400 and creates nothing", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000);

    const res = await post(f.accessToken, { amountPaisa: 10_000, clientRequestId: key() }, key());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_MISMATCH");
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id } })).toBe(0);
    expect(await heldPaisa(f.user.id)).toBe(0);
  });

  it("a malformed header is refused with 400 — never silently ignored", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000);

    const res = await post(f.accessToken, { amountPaisa: 10_000 }, "short");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id } })).toBe(0);
    expect(await heldPaisa(f.user.id)).toBe(0);
  });

  it("parallel same-key submissions reserve exactly one hold and create one row", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 60_000);
    const k = key();

    const results = await Promise.all([
      post(f.accessToken, { amountPaisa: 40_000, channel: "BKASH" }, k),
      post(f.accessToken, { amountPaisa: 40_000, channel: "BKASH" }, k),
    ]);

    const created = results.filter((r) => r.status === 201);
    const statuses = results.map((r) => r.status);
    expect(created, `statuses: ${statuses.join(",")}`).toHaveLength(1);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    // The non-creating request answers the same row (replay), whichever branch
    // observed the winner first.
    const others = results.filter((r) => r.status !== 201);
    expect(others).toHaveLength(1);
    expect(others[0]?.status).toBe(200);
    expect(others[0]?.body.data.id).toBe(created[0]?.body.data.id);

    const rows = await prisma.withdrawal.findMany({ where: { userId: f.user.id, clientRequestId: k } });
    expect(rows).toHaveLength(1);
    expect(await heldPaisa(f.user.id)).toBe(40_000);
  });

  it("the same key for a DIFFERENT user is that user's own withdrawal (keys are per user)", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    await seedBalance(a.user.id, 50_000);
    await seedBalance(b.user.id, 50_000);
    const k = key();

    const ra = await post(a.accessToken, { amountPaisa: 10_000 }, k);
    const rb = await post(b.accessToken, { amountPaisa: 10_000 }, k);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect(rb.body.data.id).not.toBe(ra.body.data.id);
    expect(rb.body.data.userId).toBe(b.user.id);
  });

  it("a refused attempt does not poison its key; the same key later creates exactly one withdrawal", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 20_000);
    const k = key();

    const refused = await post(f.accessToken, { amountPaisa: 30_000 }, k);
    expect(refused.status).toBe(422);
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id, clientRequestId: k } })).toBe(0);
    expect(await heldPaisa(f.user.id)).toBe(0);

    await seedBalance(f.user.id, 20_000);
    const created = await post(f.accessToken, { amountPaisa: 30_000 }, k);
    expect(created.status).toBe(201);
    const replay = await post(f.accessToken, { amountPaisa: 30_000 }, k);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(await heldPaisa(f.user.id)).toBe(30_000);
  });

  it("keyless submissions keep the old behaviour: each is its own withdrawal", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 60_000);

    const first = await post(f.accessToken, { amountPaisa: 20_000 });
    const second = await post(f.accessToken, { amountPaisa: 20_000 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id } })).toBe(2);
    expect(await heldPaisa(f.user.id)).toBe(40_000);
  });

  it("unauthenticated callers are rejected before any hold or row", async () => {
    const before = await prisma.withdrawal.count();
    const res = await request(app).post("/api/v1/wallet/withdrawals").send({ amountPaisa: 10_000 });
    expect(res.status).toBe(401);
    expect(await prisma.withdrawal.count()).toBe(before);
  });
});
