import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUserWithRole, createFarmWithCrop } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-102 (S1): self-dealing in the procurement money path.
 *
 * An offer's `qualityGrade` and `moisturePct` are self-declared by the seller and
 * fix `netPayablePaisa` at creation; the QC step only passes or rejects and never
 * re-measures. `PROCUREMENT_MANAGER` holds both `procurement:review` and
 * `procurement:pay`, so one account could submit an offer and walk it to payout
 * into its own wallet. The guard makes that a 403 for everyone except the
 * platform's break-glass role (SUPER_ADMIN).
 */
async function submitOfferAs(actor: { accessToken: string; userId: string }) {
  // The actor needs a farm of their own to submit an offer from.
  const { farmId } = await createFarmWithCrop(actor.accessToken);
  const res = await request(app)
    .post("/api/v1/procurement/offers")
    .set("Authorization", `Bearer ${actor.accessToken}`)
    .send({ farmId, cropName: "RICE", quantityKg: 100, qualityGrade: "A", moisturePct: 0 });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe("Procurement separation of duties (AUD-102)", () => {
  it("a procurement manager cannot review their own offer", async () => {
    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    const poId = await submitOfferAs(manager);

    const selfReview = await request(app)
      .post(`/api/v1/procurement/${poId}/review`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(selfReview.status).toBe(403);

    // Nothing moved: the offer is still where the seller left it.
    expect((await prisma.procurementOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe("SUBMITTED");
  });

  it("another manager can review it (the guard is about identity, not the role)", async () => {
    const seller = await createUserWithRole("PROCUREMENT_MANAGER");
    const reviewer = await createUserWithRole("PROCUREMENT_MANAGER");
    const poId = await submitOfferAs(seller);

    const review = await request(app)
      .post(`/api/v1/procurement/${poId}/review`)
      .set("Authorization", `Bearer ${reviewer.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe("QC");
  });

  it("a manager cannot pay out their own offer, and cannot walk it to COLLECTED alone", async () => {
    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    const reviewer = await createUserWithRole("PROCUREMENT_MANAGER");
    const poId = await submitOfferAs(manager);

    // The reviewer advances it legitimately: SUBMITTED → QC → PURCHASE_ORDER → COLLECTED.
    for (const action of ["QC_PASS", "ISSUE_PO", "COLLECT"] as const) {
      const step = await request(app)
        .post(`/api/v1/procurement/${poId}/review`)
        .set("Authorization", `Bearer ${reviewer.accessToken}`)
        .send({ action });
      expect(step.status).toBe(200);
    }

    const selfPayout = await request(app)
      .post("/api/v1/payments/payouts")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ poId });
    expect(selfPayout.status).toBe(403);

    // No credit was minted and the offer is still payable by someone else.
    expect((await prisma.procurementOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe("COLLECTED");
    expect(await prisma.walletTransaction.count({ where: { refType: "PROCUREMENT_ORDER", refId: poId } })).toBe(0);

    const legitPayout = await request(app)
      .post("/api/v1/payments/payouts")
      .set("Authorization", `Bearer ${reviewer.accessToken}`)
      .send({ poId });
    expect(legitPayout.status).toBe(201);
    expect(await prisma.walletTransaction.count({ where: { refType: "PROCUREMENT_ORDER", refId: poId } })).toBe(1);
  });
});
