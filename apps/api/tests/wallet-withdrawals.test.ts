import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

const MIN_WITHDRAWAL_PAISA = 10_000; // ৳100

/** Credits a wallet directly (payout plumbing itself is covered by journey/concurrency suites). */
async function seedBalance(userId: string, balancePaisa: number) {
  await prisma.wallet.upsert({
    where: { userId },
    update: { balancePaisa: { increment: balancePaisa } },
    create: { userId, balancePaisa },
  });
}

async function requestWithdrawal(token: string, amountPaisa: number, channel = "BKASH") {
  return request(app).post("/api/v1/wallet/withdrawals").set("Authorization", `Bearer ${token}`).send({ amountPaisa, channel });
}

async function walletState(token: string) {
  const res = await request(app).get("/api/v1/wallet").set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data as { balancePaisa: number; transactions: { direction: string; refType?: string; refId?: string; amountPaisa: number }[] };
}

describe("Wallet withdrawals — farmer requests", () => {
  it("creates a PENDING hold within balance; pending holds reduce availability; over-balance and below-min rejected", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000); // ৳1000

    const created = await requestWithdrawal(f.accessToken, 20_000);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("PENDING");
    expect(created.body.data.amountPaisa).toBe(20_000);
    // Masked destination never leaks the full phone number.
    expect(created.body.data.destination).toMatch(/^\d{3}\*\*\*\d{4}$/);

    // Hold does not debit yet.
    let wallet = await walletState(f.accessToken);
    expect(wallet.balancePaisa).toBe(100_000);

    // Summary exposes the in-flight hold.
    const summary = await request(app).get("/api/v1/wallet/summary").set("Authorization", `Bearer ${f.accessToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.pendingWithdrawalsPaisa).toBe(20_000);

    // Over-balance considering the pending hold: available = 100000-20000 = 80000.
    const over = await requestWithdrawal(f.accessToken, 90_000);
    expect(over.status).toBe(422);
    expect(over.body.error.message).toMatch(/insufficient/i);

    // Below the ৳100 minimum is a validation error.
    const belowMin = await requestWithdrawal(f.accessToken, MIN_WITHDRAWAL_PAISA - 1);
    expect(belowMin.status).toBe(400);

    wallet = await walletState(f.accessToken);
    expect(wallet.balancePaisa).toBe(100_000); // still intact
  });

  it("rejects withdrawal exceeding plain balance with 422 (no pending holds involved)", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 50_000);
    const res = await requestWithdrawal(f.accessToken, 60_000);
    expect(res.status).toBe(422);
    const list = await request(app).get("/api/v1/wallet/withdrawals").set("Authorization", `Bearer ${f.accessToken}`);
    expect(list.body.data).toHaveLength(0);
  });
});

describe("Wallet withdrawals — admin decisions", () => {
  it("APPROVE debits the wallet exactly once + writes DEBIT ledger row; MARK_PAID finalizes", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();
    await seedBalance(f.user.id, 100_000);

    const wd = await requestWithdrawal(f.accessToken, 20_000);
    expect(wd.status).toBe(201);
    const wdId = wd.body.data.id as string;

    // Admin queue shows the pending withdrawal with user context.
    const queue = await request(app).get("/api/v1/admin/withdrawals?status=PENDING").set("Authorization", `Bearer ${adminToken}`);
    expect(queue.status).toBe(200);
    const row = (queue.body.data as { id: string }[]).find((w) => w.id === wdId);
    expect(row).toBeTruthy();

    const approve = await request(app)
      .post(`/api/v1/admin/withdrawals/${wdId}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "APPROVE" });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("APPROVED");

    // Wallet debited at approval time + compensating ledger entry.
    const wallet = await walletState(f.accessToken);
    expect(wallet.balancePaisa).toBe(80_000);
    const ledger = wallet.transactions.find((t) => t.refType === "WITHDRAWAL" && t.refId === wdId);
    expect(ledger).toBeTruthy();
    expect(ledger!.direction).toBe("DEBIT");
    expect(ledger!.amountPaisa).toBe(20_000);
    expect(ledger!.balanceAfterPaisa).toBe(80_000);

    // Manual bKash transfer done -> finalize.
    const paid = await request(app)
      .post(`/api/v1/admin/withdrawals/${wdId}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "MARK_PAID", note: "bKash tx confirmed" });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe("PAID");

    // Balance debited once overall.
    const finalWallet = await walletState(f.accessToken);
    expect(finalWallet.balancePaisa).toBe(80_000);
  });

  it("double APPROVE is rejected (claim already moved)", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();
    await seedBalance(f.user.id, 30_000);
    const wd = await requestWithdrawal(f.accessToken, 10_000);
    const wdId = wd.body.data.id as string;

    const first = await request(app).post(`/api/v1/admin/withdrawals/${wdId}/decision`).set("Authorization", `Bearer ${adminToken}`).send({ action: "APPROVE" });
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/v1/admin/withdrawals/${wdId}/decision`).set("Authorization", `Bearer ${adminToken}`).send({ action: "APPROVE" });
    expect(second.status).toBe(400);

    const wallet = await walletState(f.accessToken);
    expect(wallet.balancePaisa).toBe(20_000); // single debit only
    const debits = wallet.transactions.filter((t) => t.refType === "WITHDRAWAL" && t.refId === wdId);
    expect(debits).toHaveLength(1);
  });

  it("REJECT keeps the wallet balance intact and clears the pending hold", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();
    await seedBalance(f.user.id, 40_000);

    const wd = await requestWithdrawal(f.accessToken, 15_000);
    expect(wd.status).toBe(201);

    const reject = await request(app)
      .post(`/api/v1/admin/withdrawals/${(wd.body.data as { id: string }).id}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "REJECT", note: "Destination unreachable" });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("REJECTED");

    const wallet = await walletState(f.accessToken);
    expect(wallet.balancePaisa).toBe(40_000); // untouched
    expect(wallet.transactions.filter((t) => t.direction === "DEBIT")).toHaveLength(0);

    const summary = await request(app).get("/api/v1/wallet/summary").set("Authorization", `Bearer ${f.accessToken}`);
    expect(summary.body.data.pendingWithdrawalsPaisa).toBe(0);
  });

  it("farmer cannot act on the admin decision endpoint", async () => {
    const f = await registerFarmer();
    await seedBalance(f.user.id, 20_000);
    const wd = await requestWithdrawal(f.accessToken, 10_000);
    const res = await request(app)
      .post(`/api/v1/admin/withdrawals/${(wd.body.data as { id: string }).id}/decision`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ action: "APPROVE" });
    expect(res.status).toBe(403);
  });
});
