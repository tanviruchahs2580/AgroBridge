import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * B-10 residual: object-level authorization negatives. Every one of these
 * endpoints must look like the resource does not exist to a caller who does
 * not own it — no data and no existence signal.
 */
describe("cross-user negative authorization", () => {
  it("wallet read and summary expose only the caller's rows", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();

    const txA = await prisma.walletTransaction.create({
      data: { userId: a.user.id, direction: "CREDIT", amountPaisa: 111_100, reason: "A credit", balanceAfterPaisa: 111_100 },
    });
    const txB = await prisma.walletTransaction.create({
      data: { userId: b.user.id, direction: "CREDIT", amountPaisa: 999_900, reason: "B credit", balanceAfterPaisa: 999_900 },
    });

    const wallet = await request(app).get("/api/v1/wallet").set("Authorization", `Bearer ${a.accessToken}`);
    expect(wallet.status).toBe(200);
    const ids = wallet.body.data.transactions.map((t: { id: string }) => t.id);
    expect(ids).toContain(txA.id);
    expect(ids).not.toContain(txB.id);
    expect(wallet.body.data.transactions.every((t: { userId: string }) => t.userId === a.user.id)).toBe(true);

    const summary = await request(app).get("/api/v1/wallet/summary").set("Authorization", `Bearer ${a.accessToken}`);
    expect(summary.status).toBe(200);
    // B's 999,900-paisa credit must not be part of A's month total.
    expect(summary.body.data.monthCreditsPaisa).toBe(111_100);
  });

  it("GET /ai/history returns only the caller's advisory rows", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();

    const qa = await prisma.advisoryQuery.create({
      data: { userId: a.user.id, question: "A: how to treat rice blast?", answer: "A answer", confidence: 0.7, provider: "offline", model: "kb-only" },
    });
    const qb = await prisma.advisoryQuery.create({
      data: { userId: b.user.id, question: "B: private question", answer: "B answer", confidence: 0.7, provider: "offline", model: "kb-only" },
    });

    const res = await request(app).get("/api/v1/ai/history").set("Authorization", `Bearer ${a.accessToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(qa.id);
    expect(ids).not.toContain(qb.id);
    expect(JSON.stringify(res.body)).not.toContain("private question");
  });

  it("GET /disease/cases/:id for another user's case is 404", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    const caseB = await prisma.diseaseCase.create({ data: { userId: b.user.id, imagePath: "uploads/disease/b-private.jpg" } });

    const res = await request(app).get(`/api/v1/disease/cases/${caseB.id}`).set("Authorization", `Bearer ${a.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("GET /payments/:id/status for another user's payment is 404", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    const paymentB = await prisma.payment.create({
      data: { refNo: `PAY-XUSER-${Date.now()}`, userId: b.user.id, purposeType: "ORDER", purposeId: "x", amountPaisa: 4_200, status: "PENDING" },
    });

    const res = await request(app).get(`/api/v1/payments/${paymentB.id}/status`).set("Authorization", `Bearer ${a.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
