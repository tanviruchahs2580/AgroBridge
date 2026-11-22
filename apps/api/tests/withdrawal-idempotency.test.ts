import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, requestStepUpCode } from "./helpers.js";
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
 *
 * SEC-04 (FIX-14): every withdrawal body now carries a step-up `otp`. The gate
 * sits AFTER the keyed replay fast-path — a keyed replay returns the stored row
 * without re-charging an OTP — and BEFORE the hold. Each FIRST (non-replay)
 * post below mints a fresh code; a replay reuses its original's body, which is
 * exactly the contract the shipped client gets. A fresh mint SUPERSEDES the
 * previous live challenge, so a parallel batch must share one minted code.
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
    const otp = await requestStepUpCode(f.accessToken);

    const first = await post(f.accessToken, { amountPaisa: 20_000, channel: "BKASH", otp }, k);
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe("PENDING");

    // The keyed replay reuses the original body (same otp string): the replay
    // fast-path returns the stored row BEFORE the step-up gate runs, so no new
    // code is needed — re-charging a replay would break one-key-one-withdrawal.
    const retry = await post(f.accessToken, { amountPaisa: 20_000, channel: "BKASH", otp }, k);
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
    const otp = await requestStepUpCode(f.accessToken);

    const first = await post(f.accessToken, { amountPaisa: 15_000, channel: "NAGAD", clientRequestId: k, otp });
    expect(first.status).toBe(201);
    expect(first.body.data.clientRequestId).toBe(k);

    const retry = await post(f.accessToken, { amountPaisa: 15_000, channel: "NAGAD", clientRequestId: k, otp });
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
    // One minted code for the batch (a fresh mint supersedes the previous live
    // challenge). The step-up gate runs after the replay lookup, so a racer
    // that misses the fast-path consumes the shared code at the gate; the
    // loser of the create race still lands in the lost-race replay branch.
    const otp = await requestStepUpCode(f.accessToken);

    const results = await Promise.all([
      post(f.accessToken, { amountPaisa: 40_000, channel: "BKASH", otp }, k),
      post(f.accessToken, { amountPaisa: 40_000, channel: "BKASH", otp }, k),
    ]);

    const created = results.filter((r) => r.status === 201);
    const statuses = results.map((r) => r.status);
    expect(created, `statuses: ${statuses.join(",")}`).toHaveLength(1);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    // ADJUSTED FOR SEC-04, deliberately and in the open: the step-up gate sits
    // between the replay lookup and the hold, so the non-creating request's
    // outcome depends on where its lookups landed relative to the winner:
    //   - its fast-path replay lookup hit after the winner committed -> 200
    //     replay of the SAME row (the original contract);
    //   - it missed the fast-path and its OTP consumption lost the gate race
    //     -> 422 OTP_EXPIRED, refused before any hold (the usual SQLite case,
    //     since writers are serialised; on PostgreSQL both racers can pass the
    //     gate and the unique-index backstop converts the loser into a replay).
    // The MONEY-PATH assertions stay strict either way: ONE row for the key and
    // ONE hold — a parallel same-key batch can never pay out twice.
    const others = results.filter((r) => r.status !== 201);
    expect(others).toHaveLength(1);
    const loser = others[0];
    expect(
      (loser.status === 200 && loser.body.data.id === created[0]?.body.data.id) ||
        (loser.status === 422 && loser.body.error.code === "OTP_EXPIRED"),
      `loser answered neither a keyed replay nor a step-up gate refusal: ${loser.status} ${JSON.stringify(loser.body.error ?? {})}`
    ).toBeTruthy();

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

    // Separate users hold separate step-up challenges — each first post mints
    // with its own token.
    const ra = await post(a.accessToken, { amountPaisa: 10_000, otp: await requestStepUpCode(a.accessToken) }, k);
    const rb = await post(b.accessToken, { amountPaisa: 10_000, otp: await requestStepUpCode(b.accessToken) }, k);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect(rb.body.data.id).not.toBe(ra.body.data.id);
    expect(rb.body.data.userId).toBe(b.user.id);
  });

  it("a refused attempt does not poison its key; the same key later creates exactly one withdrawal", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 20_000);
    const k = key();

    // The refusal happens after the step-up gate (which consumed this code) and
    // before the hold, so the retry below mints a FRESH code.
    const refused = await post(f.accessToken, { amountPaisa: 30_000, otp: await requestStepUpCode(f.accessToken) }, k);
    expect(refused.status).toBe(422);
    expect(await prisma.withdrawal.count({ where: { userId: f.user.id, clientRequestId: k } })).toBe(0);
    expect(await heldPaisa(f.user.id)).toBe(0);

    await seedBalance(f.user.id, 20_000);
    const createdBody = { amountPaisa: 30_000, otp: await requestStepUpCode(f.accessToken) };
    const created = await post(f.accessToken, createdBody, k);
    expect(created.status).toBe(201);
    // Replay of the created request: the exact same body (same otp string) —
    // the fast-path returns the stored row before the gate re-charges anything.
    const replay = await post(f.accessToken, createdBody, k);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(await heldPaisa(f.user.id)).toBe(30_000);
  });

  it("keyless submissions keep the old behaviour: each is its own withdrawal", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 60_000);

    // No key: each post is a FIRST post and consumes its own fresh code.
    const first = await post(f.accessToken, { amountPaisa: 20_000, otp: await requestStepUpCode(f.accessToken) });
    const second = await post(f.accessToken, { amountPaisa: 20_000, otp: await requestStepUpCode(f.accessToken) });
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
