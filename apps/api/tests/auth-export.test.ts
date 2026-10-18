import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { KNOWLEDGE_BASE } from "../src/providers/ai/knowledge.js";

/**
 * AUD-130: GET /api/v1/auth/me/export — a JSON attachment with ONLY the
 * caller's data (profile minus passwordHash, farms, orders, payments, wallet,
 * bookings, procurement offers, disease-case metadata, notifications,
 * advisory history, organization memberships).
 */
describe("GET /api/v1/auth/me/export", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/auth/me/export");
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("returns an attachment containing the caller's ids and never another user's", async () => {
    const a = await registerFarmer({ fullName: "Export Owner A", password: "ExportA@1234" });
    const b = await registerFarmer({ fullName: "Other User B", password: "ExportB@1234" });

    // Owner A: real farm/plot/crop-cycle via the API (farmEvents included).
    const farmA = await createFarmWithCrop(a.accessToken, "ধান", 12);
    await prisma.walletTransaction.create({
      data: { userId: a.user.id, direction: "CREDIT", amountPaisa: 12_345, reason: "Test export credit", balanceAfterPaisa: 12_345 },
    });
    const notifA = await prisma.notification.create({
      data: { userId: a.user.id, type: "SYSTEM", title: "Export me", body: "Export me" },
    });
    const advisoryA = await prisma.advisoryQuery.create({
      data: {
        userId: a.user.id,
        question: "How much urea for boro rice?",
        answer: "Follow the KB dose.",
        confidence: 0.8,
        provider: "offline",
        model: "kb-only",
        // One live ref + one ref removed from the KB since the answer was stored.
        groundedRefs: JSON.stringify([KNOWLEDGE_BASE[0]!.id, "kb-entry-removed-forever"]),
      },
    });
    await prisma.diseaseCase.create({
      data: { userId: a.user.id, imagePath: "uploads/disease/export-a.jpg", cropGuess: "rice" },
    });
    const paymentA = await prisma.payment.create({
      data: { refNo: `PAY-EXPA-${Date.now()}`, userId: a.user.id, purposeType: "ORDER", purposeId: "x", amountPaisa: 5_000, status: "SUCCEEDED" },
    });
    const orgA = await prisma.organization.create({
      data: { name: "Export Test Coop", type: "COOPERATIVE", members: { create: { userId: a.user.id, role: "MEMBER" } } },
    });

    // Other user B: same table families, must never appear in A's export.
    const farmB = await prisma.farm.create({
      data: {
        ownerId: b.user.id,
        name: "B Farm",
        plots: { create: { name: "B plot", areaBigha: 1, cropCycles: { create: { cropName: "corn", plantedAt: new Date() } } } },
      },
    });
    const txB = await prisma.walletTransaction.create({
      data: { userId: b.user.id, direction: "CREDIT", amountPaisa: 999_999, reason: "B credit", balanceAfterPaisa: 999_999 },
    });
    const notifB = await prisma.notification.create({
      data: { userId: b.user.id, type: "SYSTEM", title: "B private", body: "B private" },
    });
    const advisoryB = await prisma.advisoryQuery.create({
      data: { userId: b.user.id, question: "B question", answer: "B answer", confidence: 0.5, provider: "offline", model: "kb-only" },
    });
    const caseB = await prisma.diseaseCase.create({
      data: { userId: b.user.id, imagePath: "uploads/disease/export-b.jpg" },
    });
    const paymentB = await prisma.payment.create({
      data: { refNo: `PAY-EXPB-${Date.now()}`, userId: b.user.id, purposeType: "ORDER", purposeId: "y", amountPaisa: 7_777, status: "PENDING" },
    });

    const res = await request(app).get("/api/v1/auth/me/export").set("Authorization", `Bearer ${a.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="agrobridge-export-${a.user.id}.json"`);
    expect(res.headers["cache-control"]).toBe("no-store");

    const raw = JSON.stringify(res.body);
    // Raw bytes must never carry the password hash — for anyone.
    expect(raw).not.toContain("passwordHash");
    expect(res.body.user.passwordHash).toBeUndefined();
    // Caller's own data is present.
    expect(res.body.user.id).toBe(a.user.id);
    expect(res.body.user.phone).toBe(a.phone);
    expect(raw).toContain(farmA.farmId);
    expect(raw).toContain(farmA.cropId);
    expect(raw).toContain(notifA.id);
    expect(raw).toContain(advisoryA.id);
    expect(raw).toContain(paymentA.id);
    expect(raw).toContain(orgA.name);
    // Every other user's identifier is absent.
    for (const foreign of [b.user.id, b.phone, farmB.id, txB.id, notifB.id, advisoryB.id, caseB.id, paymentB.id]) {
      expect(raw, `export leaked another user's id: ${foreign}`).not.toContain(foreign);
    }
    // Advisory refs are filtered against the live KB, like /ai/history.
    expect(res.body.advisoryQueries[0].groundedRefs).toEqual([KNOWLEDGE_BASE[0]!.id]);
    expect(raw).not.toContain("kb-entry-removed-forever");

    // Farm tree shape: farm → plots → cropCycles (+ farmEvents array).
    const farm = res.body.farms.find((f: { id: string }) => f.id === farmA.farmId);
    expect(farm.plots[0].cropCycles[0].id).toBe(farmA.cropId);
    expect(Array.isArray(farm.farmEvents)).toBe(true);
  });
});
