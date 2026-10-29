import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createFarmWithCrop, createUserWithRole, getAdmin, registerFarmer } from "./helpers.js";

/**
 * A territory-scoped role with **no region assigned** — the case BR-23 does not
 * describe and no test covered.
 *
 * BR-23 says "a territory manager may only act on offers whose owner is in their
 * region". `lib/territory.ts` deliberately fails open for a manager whose `region` is
 * empty, and the queue endpoint returns every region's offers — each row carrying the
 * farmer's `fullName` and `phone`. An operator creates that state in one PATCH
 * (`PATCH /admin/users/:id` with a role and no region), so it is a configuration
 * omission rather than an attack.
 *
 * This test pins the CURRENT behaviour so it cannot change unnoticed in either
 * direction. If it fails because you tightened the default: that is a decision, not a
 * bug — update `lib/territory.ts`, this test, `docs/business-rules.md` BR-23 and
 * ODL-007 together. If it fails because the unassigned manager now sees *nothing*,
 * the operator-facing docs and the warning log need the same treatment.
 */
describe("territory scope: a manager with no region assigned", () => {
  it("sees every region's offers, including each farmer's name and phone (current default, ODL-007)", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const north = await registerFarmer();
    const south = await registerFarmer();

    await request(app)
      .patch(`/api/v1/admin/users/${north.user.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ region: "DHAKA_NORTH" });
    await request(app)
      .patch(`/api/v1/admin/users/${south.user.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ region: "CHITTAGONG" });

    const northOffer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${north.accessToken}`)
      .send({ farmId: (await createFarmWithCrop(north.accessToken)).farmId, cropName: "WHEAT", quantityKg: 120, qualityGrade: "B" });
    const southOffer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${south.accessToken}`)
      .send({ farmId: (await createFarmWithCrop(south.accessToken)).farmId, cropName: "RICE", quantityKg: 220, qualityGrade: "C" });
    expect([northOffer.status, southOffer.status]).toEqual([201, 201]);

    // Role assigned, region deliberately left empty.
    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    const queue = await request(app).get("/api/v1/procurement").set("Authorization", `Bearer ${manager.accessToken}`);
    expect(queue.status).toBe(200);

    const ids = (queue.body.data as { id: string }[]).map((p) => p.id);
    expect(ids, "an unassigned territory manager currently sees every region's queue").toContain(northOffer.body.data.id);
    expect(ids, "an unassigned territory manager currently sees every region's queue").toContain(southOffer.body.data.id);

    // The exposure is personal data, not just counts: every row carries the farmer's
    // identity. This assertion is the reason the case is recorded rather than ignored.
    const row = (queue.body.data as { user?: { fullName?: string; phone?: string } }[])[0];
    expect(row?.user?.fullName, "the queue exposes farmer names").toBeTruthy();
    expect(row?.user?.phone, "the queue exposes farmer phone numbers").toBeTruthy();

    // And the guard on mutations lets the same unassigned manager act, because a null
    // region reads as "unrestricted" there too.
    const reviewed = await request(app)
      .post(`/api/v1/procurement/${southOffer.body.data.id}/review`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(reviewed.status, "an unassigned manager can currently act on another region's offer").toBe(200);
  });

  it("a manager WITH a region stays scoped even while an unassigned one exists", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const north = await registerFarmer();
    const south = await registerFarmer();
    await request(app)
      .patch(`/api/v1/admin/users/${north.user.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ region: "RAJSHAHI" });
    await request(app)
      .patch(`/api/v1/admin/users/${south.user.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ region: "BARISHAL" });

    const northOffer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${north.accessToken}`)
      .send({ farmId: (await createFarmWithCrop(north.accessToken)).farmId, cropName: "MAIZE", quantityKg: 90, qualityGrade: "A" });
    const southOffer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${south.accessToken}`)
      .send({ farmId: (await createFarmWithCrop(south.accessToken)).farmId, cropName: "JUTE", quantityKg: 150, qualityGrade: "B" });

    const scopedManager = await createUserWithRole("PROCUREMENT_MANAGER");
    await request(app)
      .patch(`/api/v1/admin/users/${scopedManager.userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ region: "RAJSHAHI" });

    const queue = await request(app).get("/api/v1/procurement").set("Authorization", `Bearer ${scopedManager.accessToken}`);
    const ids = (queue.body.data as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(northOffer.body.data.id);
    expect(ids, "BR-23: a scoped manager never sees another region's offer").not.toContain(southOffer.body.data.id);
  });
});
