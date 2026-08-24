import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop, createUserWithRole } from "./helpers.js";

/** Journey 7: book agricultural service; Journey 8: procurement; payout to wallet */
describe("Journey 7 — Service booking lifecycle", () => {
  it("creates booking with provider and auditable price estimate", async () => {
    const f = await registerFarmer();
    const farm = await createFarmWithCrop(f.accessToken);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const drone = services.body.data.find((s: { code: string }) => s.code === "DRONE_SPRAY");
    expect(drone).toBeTruthy();

    const res = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({
        farmId: farm.farmId,
        serviceId: drone.id,
        scheduledFor: new Date(Date.now() + 3 * 86400000).toISOString(),
        areaBigha: 2,
        providerId: drone.providers?.[0]?.id,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.estimatedPricePaisa).toBe(35_000 * 2); // base price x area
    expect(res.body.data.status).toBe("ASSIGNED");
  });

  it("rejects past scheduling", async () => {
    const f = await registerFarmer();
    const farm = await createFarmWithCrop(f.accessToken);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const svc = services.body.data[0];
    const res = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ farmId: farm.farmId, serviceId: svc.id, scheduledFor: new Date(Date.now() - 86400000).toISOString(), areaBigha: 1 });
    expect(res.status).toBe(422);
  });

  it("RBAC: farmer cannot assign provider; admin assigns; completion + rating flow", async () => {
    const f = await registerFarmer();
    const admin = await getAdminToken();

    const farm = await createFarmWithCrop(f.accessToken);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const tractor = services.body.data.find((s: { code: string }) => s.code === "TRACTOR_PLOUGH");

    const created = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ farmId: farm.farmId, serviceId: tractor.id, scheduledFor: new Date(Date.now() + 86400000).toISOString(), areaBigha: 1.5 });
    const bookingId = created.body.data.id;

    const farmerAssign = await request(app)
      .post(`/api/v1/bookings/${bookingId}/assign`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ providerId: tractor.providers[0].id });
    expect(farmerAssign.status).toBe(403);

    const assigned = await request(app)
      .post(`/api/v1/bookings/${bookingId}/assign`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ providerId: tractor.providers[0].id });
    expect(assigned.status).toBe(200);

    const earlyRating = await request(app)
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ rating: 5 });
    expect(earlyRating.status).toBe(422); // cannot rate before completion

    await request(app)
      .post(`/api/v1/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ status: "COMPLETED" });

    const rated = await request(app)
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ rating: 5 });
    expect(rated.status).toBe(200);

    // Provider aggregate updated
    const again = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const updatedProvider = again.body.data
      .find((s: { code: string }) => s.code === "TRACTOR_PLOUGH")
      ?.providers?.find((p: { id: string }) => p.id === tractor.providers[0].id);
    expect(updatedProvider.ratingCount).toBeGreaterThan(0);
  });

  it("sandbox payment marks booking paid (clearly labelled sandbox)", async () => {
    const f = await registerFarmer();
    const farm = await createFarmWithCrop(f.accessToken);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const svc = services.body.data[0];
    const created = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ farmId: farm.farmId, serviceId: svc.id, scheduledFor: new Date(Date.now() + 86400000).toISOString(), areaBigha: 1 });

    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ purposeType: "BOOKING", purposeId: created.body.data.id });
    expect(intent.status).toBe(201);
    expect(intent.body.data.providerMode).toBe("sandbox");

    const confirm = await request(app)
      .post(`/api/v1/payments/${intent.body.data.paymentId}/confirm`)
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe("SUCCEEDED");
  });

  async function getAdminToken(): Promise<string> {
    const login = await request(app).post("/api/v1/auth/login").send({ phone: "01700000001", password: "Demo@1234" });
    return login.body.data.accessToken as string;
  }
});

/** Journey 8: procurement offer → QC → PO → collect → payout → wallet credit */
describe("Journey 8 — Procurement & wallet payout", () => {
  it("rejects crop outside catalogue with clear guidance", async () => {
    const f = await registerFarmer();
    const farm = await createFarmWithCrop(f.accessToken);
    const res = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ farmId: farm.farmId, cropName: "DRAGON_FRUIT", quantityKg: 100, qualityGrade: "A" });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/catalogue/i);
  });

  it("runs full pipeline: submit → QC → PO → collect → payout → wallet credited", async () => {
    const f = await registerFarmer();
    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    const farm = await createFarmWithCrop(f.accessToken);

    // Farmer submits offer (1000kg rice, grade B, 16% moisture → auditable deductions)
    const submitted = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ farmId: farm.farmId, cropName: "RICE", quantityKg: 1000, moisturePct: 16, qualityGrade: "B" });
    expect(submitted.status).toBe(201);
    const calc = submitted.body.data.calculation;
    const gross = Math.round(1000 * 3200 * 0.92);
    expect(calc.grossPaisa).toBe(gross);
    expect(calc.deductionsPaisa).toBe(Math.round(gross * 0.01));
    expect(submitted.body.data.netPayablePaisa).toBe(gross - calc.deductionsPaisa);

    const poId = submitted.body.data.id;

    // Farmer cannot review (server-side RBAC)
    const farmerReview = await request(app)
      .post(`/api/v1/procurement/${poId}/review`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(farmerReview.status).toBe(403);

    // Manager walks the state machine; invalid jumps rejected
    for (const [action, expected] of [
      ["ISSUE_PO", 422],
      ["QC_PASS", 200],
      ["QC_PASS", 422],
      ["ISSUE_PO", 200],
      ["COLLECT", 200],
    ] as const) {
      const r = await request(app)
        .post(`/api/v1/procurement/${poId}/review`)
        .set("Authorization", `Bearer ${manager.accessToken}`)
        .send({ action, qcNotes: action === "QC_PASS" ? "Grade verified on sample" : undefined });
      expect(r.status).toBe(expected);
    }

    // Farmer cannot pay out
    const farmerPayout = await request(app)
      .post("/api/v1/payments/payouts")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ poId });
    expect(farmerPayout.status).toBe(403);

    // Manager pays out to wallet
    const payout = await request(app)
      .post("/api/v1/payments/payouts")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ poId });
    expect(payout.status).toBe(201);
    expect(payout.body.data.payment.amountPaisa).toBe(submitted.body.data.netPayablePaisa);

    // Wallet reflects credit + transaction ledger entry
    const wallet = await request(app).get("/api/v1/wallet").set("Authorization", `Bearer ${f.accessToken}`);
    expect(wallet.body.data.balancePaisa).toBeGreaterThanOrEqual(submitted.body.data.netPayablePaisa);
    const credit = wallet.body.data.transactions.find((t: { refId?: string }) => t.refId === poId);
    expect(credit.direction).toBe("CREDIT");
  });
});
