import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Regression tests for the withdrawal double-spend race (QA 2026-09-15):
 * previously the request handler read a SUM of PENDING withdrawals and then
 * created a new Withdrawal row — two parallel requests could both observe the
 * same pre-lock snapshot and both pass the availability check, over-committing
 * the wallet. Withdrawals now reserve funds in `Wallet.heldPaisa` serialized
 * under the wallet row's write lock, so only one request can win the last of
 * the available balance.
 */
async function seedBalance(userId: string, balancePaisa: number) {
  await prisma.wallet.upsert({
    where: { userId },
    update: { balancePaisa: { increment: balancePaisa } },
    create: { userId, balancePaisa },
  });
}

async function requestWithdrawal(token: string, amountPaisa: number) {
  return request(app).post("/api/v1/wallet/withdrawals").set("Authorization", `Bearer ${token}`).send({ amountPaisa, channel: "BKASH" });
}

describe("Withdrawal race — holds are serialized under the wallet lock", () => {
  it("two parallel withdrawals for more than available balance: exactly one succeeds", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000); // ৳1000

    const results = await Promise.all([requestWithdrawal(f.accessToken, 90_000), requestWithdrawal(f.accessToken, 90_000)]);
    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.body.error.message).toMatch(/insufficient/i);

    // Invariants: wallet never over-committed; hold matches the one live request.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.user.id } });
    expect(wallet.balancePaisa).toBe(100_000); // hold does not debit
    expect(wallet.heldPaisa).toBe(90_000);

    // Summary reports the hold consistently.
    const summary = await request(app).get("/api/v1/wallet/summary").set("Authorization", `Bearer ${f.accessToken}`);
    expect(summary.body.data.pendingWithdrawalsPaisa).toBe(90_000);
  });

  it("N parallel withdrawals over-commit nothing beyond available balance", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 50_000);

    const results = await Promise.all(Array.from({ length: 5 }, () => requestWithdrawal(f.accessToken, 15_000)));
    const created = results.filter((r) => r.status === 201);

    // 50k available, 15k each -> at most 3 can succeed.
    expect(created.length).toBeLessThanOrEqual(3);
    expect(created.length * 15_000).toBeLessThanOrEqual(50_000);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.user.id } });
    expect(wallet.heldPaisa).toBe(created.length * 15_000);

    // heldPaisa must equal the sum of PENDING withdrawal rows (reconciliation invariant).
    const pending = await prisma.withdrawal.aggregate({
      where: { userId: f.user.id, status: "PENDING" },
      _sum: { amountPaisa: true },
    });
    expect(wallet.heldPaisa).toBe(pending._sum.amountPaisa ?? 0);
  });

  it("REJECT releases the hold so funds become withdrawable again", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000);

    const wd = await requestWithdrawal(f.accessToken, 90_000);
    expect(wd.status).toBe(201);

    // Now fully held: a second withdrawal fails.
    const second = await requestWithdrawal(f.accessToken, 20_000);
    expect(second.status).toBe(422);

    // Admin rejects -> hold released.
    const reject = await request(app)
      .post(`/api/v1/admin/withdrawals/${wd.body.data.id}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "REJECT" });
    expect(reject.status).toBe(200);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.user.id } });
    expect(wallet.heldPaisa).toBe(0);
    expect(wallet.balancePaisa).toBe(100_000); // rejection does not debit

    const retry = await requestWithdrawal(f.accessToken, 20_000);
    expect(retry.status).toBe(201);
  });

  it("APPROVE debits balance and releases the hold exactly once", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000);

    const wd = await requestWithdrawal(f.accessToken, 40_000);
    expect(wd.status).toBe(201);
    const wdId = wd.body.data.id as string;

    const approve = await request(app)
      .post(`/api/v1/admin/withdrawals/${wdId}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "APPROVE" });
    expect(approve.status).toBe(200);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.user.id } });
    expect(wallet.balancePaisa).toBe(60_000);
    expect(wallet.heldPaisa).toBe(0); // hold consumed by the debit

    // APPROVED no longer blocks: remaining 60k available.
    const next = await requestWithdrawal(f.accessToken, 60_000);
    expect(next.status).toBe(201);
  });
});
