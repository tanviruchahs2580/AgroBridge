import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createUserWithRole, createFarmWithCrop, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Admin user-management boundaries (who may page the directory, who may change
 * roles) and the territory scope of procurement mutations.
 *
 * Renamed/split from `round10-regressions` (F-92).
 */
describe("admin user and procurement authorization", () => {
  it("admin user directory requires users:read (territory roles are refused)", async () => {
    const regional = await createUserWithRole("REGIONAL_MANAGER");
    const res = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${regional.accessToken}`);
    expect(res.status).toBe(403);

    const admin = await getAdmin();
    const allowed = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(allowed.status).toBe(200);
  });

  it("an ADMIN cannot grant SUPER_ADMIN or modify an admin account", async () => {
    const admin = await getAdmin();
    const victim = await registerFarmer();

    const escalate = await request(app)
      .patch(`/api/v1/admin/users/${victim.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "SUPER_ADMIN" });
    expect(escalate.status).toBe(403);

    const target = await createUserWithRole("SUPER_ADMIN");
    const demote = await request(app)
      .patch(`/api/v1/admin/users/${target.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(demote.status).toBe(403);

    // A non-privileged role change is still allowed for an ADMIN.
    const okChange = await request(app)
      .patch(`/api/v1/admin/users/${victim.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "DEALER" });
    expect(okChange.status).toBe(200);
  });

  it("an admin cannot change its own role", async () => {
    const admin = await getAdmin();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ role: "FARMER" });
    expect(res.status).toBe(400);
  });

  it("territory-scoped reviewers cannot act on another region's procurement order", async () => {
    // Farmer in Rangpur submits an offer for a catalogued crop.
    const farmer = await registerFarmer();
    const farm = await createFarmWithCrop(farmer.accessToken);
    const offer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${farmer.accessToken}`)
      .send({ farmId: farm.farmId, cropName: "RICE", quantityKg: 500, qualityGrade: "A", moisturePct: 12 });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const poId = offer.body.data.id as string;

    // Region is a user attribute (assigned by an admin), and the list endpoint
    // scopes on exactly this field — put the farmer in Rangpur to model that.
    await prisma.user.update({ where: { id: farmer.user.id }, data: { region: "Rangpur" } });

    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    await prisma.user.update({ where: { id: manager.userId }, data: { region: "Khulna" } });
    const denied = await request(app)
      .post(`/api/v1/procurement/${poId}/review`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(denied.status).toBe(403);

    // The same manager with the farmer's region may proceed.
    await prisma.user.update({ where: { id: manager.userId }, data: { region: "Rangpur" } });
    const allowed = await request(app)
      .post(`/api/v1/procurement/${poId}/review`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ action: "QC_PASS" });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.status).toBe("QC");
  });
});
