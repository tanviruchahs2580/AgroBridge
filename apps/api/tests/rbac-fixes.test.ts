import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop, createUserWithRole, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("RBAC fixes — service provider booking scope", () => {
  it("SERVICE_PROVIDER can transition own assigned bookings; another provider's booking is 404", async () => {
    const f = await registerFarmer();
    const spA = await createUserWithRole("SERVICE_PROVIDER");
    const spB = await createUserWithRole("SERVICE_PROVIDER");

    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const drone = services.body.data.find((s: { code: string }) => s.code === "DRONE_SPRAY");
    expect(drone).toBeTruthy();

    // Two providers, each linked to a distinct user account.
    const providerA = await prisma.serviceProvider.create({
      data: { serviceId: drone.id, userId: spA.userId, name: `Provider A ${Date.now()}` },
    });
    // Provider B exists and is active, but is not the assigned provider.
    await prisma.serviceProvider.create({
      data: { serviceId: drone.id, userId: spB.userId, name: `Provider B ${Date.now()}` },
    });

    // Farmer books and is assigned provider A.
    const booking = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({
        farmId: (await createFarmWithCrop(f.accessToken)).farmId,
        serviceId: drone.id,
        providerId: providerA.id,
        scheduledFor: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        areaBigha: 1,
      });
    expect(booking.status).toBe(201);
    expect(booking.body.data.status).toBe("ASSIGNED");
    const bookingId = booking.body.data.id as string;

    // Provider B must not even learn the booking exists (no existence oracle).
    const crossAttempt = await request(app)
      .post(`/api/v1/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${spB.accessToken}`)
      .send({ status: "IN_PROGRESS" });
    expect(crossAttempt.status).toBe(404);
    expect(crossAttempt.body.error.code).toBe("NOT_FOUND");

    const untouched = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(untouched.status).toBe("ASSIGNED");

    // The assigned provider transitions their own booking.
    const own = await request(app)
      .post(`/api/v1/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${spA.accessToken}`)
      .send({ status: "IN_PROGRESS" });
    expect(own.status).toBe(200);
    expect(own.body.data.status).toBe("IN_PROGRESS");

    const complete = await request(app)
      .post(`/api/v1/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${spA.accessToken}`)
      .send({ status: "COMPLETED" });
    expect(complete.status).toBe(200);
  });

  it("provider without a linked profile gets a scoped 404, not an error leak", async () => {
    const orphan = await createUserWithRole("SERVICE_PROVIDER");
    const f = await registerFarmer();
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const svc = services.body.data[0];
    const booking = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({
        farmId: (await createFarmWithCrop(f.accessToken)).farmId,
        serviceId: svc.id,
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        areaBigha: 1,
      });
    const attempt = await request(app)
      .post(`/api/v1/bookings/${booking.body.data.id}/status`)
      .set("Authorization", `Bearer ${orphan.accessToken}`)
      .send({ status: "CANCELLED" });
    expect(attempt.status).toBe(404);
  });
});

describe("RBAC fixes — farm organization reparent blocked", () => {
  it("PATCH /farms/:id silently ignores organizationId (cannot attach farm to arbitrary org)", async () => {
    const corp = await createUserWithRole("CORPORATE");
    const org = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${corp.accessToken}`)
      .send({ name: `Hijack Target ${Date.now()}`, type: "CORPORATE" });
    expect(org.status).toBe(201);

    const f = await registerFarmer();
    const farmRes = await request(app)
      .post("/api/v1/farms")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ name: "Independent Farm", district: "রংপুর" });
    expect(farmRes.status).toBe(201);
    const farmId = farmRes.body.data.id as string;
    expect(farmRes.body.data.organizationId).toBeNull();

    const patched = await request(app)
      .patch(`/api/v1/farms/${farmId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ name: "Renamed Farm", organizationId: org.body.data.id });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe("Renamed Farm"); // allowed fields still apply
    expect(patched.body.data.organizationId).toBeNull(); // reparent stripped

    const stored = await prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
    expect(stored.organizationId).toBeNull();
  });
});

describe("RBAC fixes — procurement review race safety & region scoping", () => {
  it("two concurrent reviewers on one SUBMITTED offer: exactly one 200, one 422", async () => {
    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    const reviewer2 = await createUserWithRole("PROCUREMENT_MANAGER");
    const f = await registerFarmer();
    const { farmId } = await createFarmWithCrop(f.accessToken);

    const submitted = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ farmId, cropName: "RICE", quantityKg: 100, qualityGrade: "A" });
    expect(submitted.status).toBe(201);
    const poId = submitted.body.data.id as string;

    // Same transition fired concurrently — the conditional updateMany inside
    // the transaction lets exactly one claim win.
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/v1/procurement/${poId}/review`).set("Authorization", `Bearer ${manager.accessToken}`).send({ action: "QC_PASS" }),
      request(app).post(`/api/v1/procurement/${poId}/review`).set("Authorization", `Bearer ${reviewer2.accessToken}`).send({ action: "QC_PASS" }),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 422]);
    expect(r1.status === 422 || r1.status === 200).toBe(true);

    const po = await prisma.procurementOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe("QC"); // advanced exactly once
  });

  it("managers only see offers whose owner matches their assigned region", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const fNorth = await registerFarmer();
    const fSouth = await registerFarmer();

    // Territory assignment happens via admin user management.
    await request(app).patch(`/api/v1/admin/users/${fNorth.user.id}`).set("Authorization", `Bearer ${adminToken}`).send({ region: "DHAKA_NORTH" });
    await request(app).patch(`/api/v1/admin/users/${fSouth.user.id}`).set("Authorization", `Bearer ${adminToken}`).send({ region: "CHITTAGONG" });

    const northOffer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${fNorth.accessToken}`)
      .send({ farmId: (await createFarmWithCrop(fNorth.accessToken)).farmId, cropName: "WHEAT", quantityKg: 300, qualityGrade: "B" });
    const southOffer = await request(app)
      .post("/api/v1/procurement/offers")
      .set("Authorization", `Bearer ${fSouth.accessToken}`)
      .send({ farmId: (await createFarmWithCrop(fSouth.accessToken)).farmId, cropName: "RICE", quantityKg: 400, qualityGrade: "C" });
    expect(northOffer.status).toBe(201);
    expect(southOffer.status).toBe(201);

    const manager = await createUserWithRole("PROCUREMENT_MANAGER");
    await request(app).patch(`/api/v1/admin/users/${manager.userId}`).set("Authorization", `Bearer ${adminToken}`).send({ region: "DHAKA_NORTH" });

    const scoped = await request(app).get("/api/v1/procurement").set("Authorization", `Bearer ${manager.accessToken}`);
    expect(scoped.status).toBe(200);
    const scopedIds = (scoped.body.data as { id: string }[]).map((p) => p.id);
    expect(scopedIds).toContain(northOffer.body.data.id);
    expect(scopedIds).not.toContain(southOffer.body.data.id);

    // Admins remain unscoped.
    const adminView = await request(app).get("/api/v1/procurement").set("Authorization", `Bearer ${adminToken}`);
    const adminIds = (adminView.body.data as { id: string }[]).map((p) => p.id);
    expect(adminIds).toContain(northOffer.body.data.id);
    expect(adminIds).toContain(southOffer.body.data.id);
  });

  it("admin PATCH /users/:id accepts and persists region", async () => {
    const adminToken = (await getAdmin()).accessToken;
    const f = await registerFarmer();
    const patched = await request(app)
      .patch(`/api/v1/admin/users/${f.user.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ region: "SYLHET" });
    expect(patched.status).toBe(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(stored.region).toBe("SYLHET");
  });
});
