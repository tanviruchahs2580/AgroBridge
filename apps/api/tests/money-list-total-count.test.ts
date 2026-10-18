import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { refNo } from "../src/lib/money.js";

/**
 * C-06/C-22 residual: every money list is returned as a capped slice with no
 * way for the caller to tell a full list from a truncated one. `X-Total-Count`
 * now carries the true count of the exact scope the slice was taken from:
 * GET /orders (own or admin scope), GET /payments (own or admin scope),
 * GET /admin/withdrawals (finance queue) and GET /wallet (ledger, cap 50).
 * Bodies are unchanged.
 */
function orderData(userId: string) {
  return {
    orderNo: refNo("ORD"),
    userId,
    status: "CONFIRMED",
    subtotalPaisa: 5_000,
    discountPaisa: 0,
    deliveryFeePaisa: 0,
    totalPaisa: 5_000,
  };
}

describe("X-Total-Count on money lists (C-06/C-22)", () => {
  it("GET /orders: header equals the user-scoped DB count (body is that slice)", async () => {
    const f = await registerFarmer();
    await prisma.order.createMany({ data: [orderData(f.user.id), orderData(f.user.id), orderData(f.user.id)] });

    const res = await request(app).get("/api/v1/orders").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    const total = await prisma.order.count({ where: { userId: f.user.id } });
    expect(total).toBe(3);
    expect(res.headers["x-total-count"]).toBe(String(total));
    expect(res.body.data).toHaveLength(total);
  });

  it("GET /payments: header equals the scope's count for a user and for an admin", async () => {
    const f = await registerFarmer();
    await prisma.payment.createMany({
      data: [
        { refNo: refNo("PAY"), userId: f.user.id, purposeType: "ORDER", purposeId: "seed-1", amountPaisa: 1_000 },
        { refNo: refNo("PAY"), userId: f.user.id, purposeType: "ORDER", purposeId: "seed-2", amountPaisa: 2_000, status: "SUCCEEDED" },
      ],
    });

    const own = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${f.accessToken}`);
    expect(own.status).toBe(200);
    const ownTotal = await prisma.payment.count({ where: { userId: f.user.id } });
    expect(ownTotal).toBe(2);
    expect(own.headers["x-total-count"]).toBe(String(ownTotal));
    expect(own.body.data).toHaveLength(ownTotal);

    // Admin scope: the header is the global total (never a per-slice count).
    const admin = await getAdmin();
    const all = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(all.status).toBe(200);
    const allTotal = await prisma.payment.count();
    expect(allTotal).toBeGreaterThanOrEqual(ownTotal);
    expect(all.headers["x-total-count"]).toBe(String(allTotal));
    // Body stays capped at 100: assert the slice, not inequality with total
    // (this file may run after suites that created more than 100 payments).
    expect(all.body.data).toHaveLength(Math.min(allTotal, 100));
  });

  it("GET /admin/withdrawals: header equals the selected status' count in the finance queue", async () => {
    const f = await registerFarmer();
    await prisma.withdrawal.createMany({
      data: [
        { refNo: refNo("WDL"), userId: f.user.id, amountPaisa: 20_000, channel: "BKASH", destination: "017***0001", status: "PENDING" },
        { refNo: refNo("WDL"), userId: f.user.id, amountPaisa: 30_000, channel: "NAGAD", destination: "017***0002", status: "PENDING" },
        { refNo: refNo("WDL"), userId: f.user.id, amountPaisa: 40_000, channel: "BANK", destination: "017***0003", status: "REJECTED" },
      ],
    });

    const admin = await getAdmin();
    const res = await request(app)
      .get("/api/v1/admin/withdrawals?status=PENDING")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    const total = await prisma.withdrawal.count({ where: { status: "PENDING" } });
    expect(total).toBeGreaterThanOrEqual(2);
    expect(res.headers["x-total-count"]).toBe(String(total));
    expect(res.body.data).toHaveLength(Math.min(total, 100));
    // The REJECTED row is out of scope for both the body and the header.
    expect(res.body.data.some((w: { status: string }) => w.status !== "PENDING")).toBe(false);
  });

  it("GET /wallet: ledger slice is capped at 50 while the header carries the true count (truncation visible)", async () => {
    const f = await registerFarmer();
    await prisma.walletTransaction.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        userId: f.user.id,
        direction: "CREDIT",
        amountPaisa: 100 + i,
        reason: `seed ${i}`,
        balanceAfterPaisa: 100 + i,
      })),
    });

    const res = await request(app).get("/api/v1/wallet").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    expect(await prisma.walletTransaction.count({ where: { userId: f.user.id } })).toBe(55);
    expect(res.headers["x-total-count"]).toBe("55");
    expect(res.body.data.transactions).toHaveLength(50); // capped slice, unchanged
    expect(res.body.data.balancePaisa).toBe(0);
  });
});
