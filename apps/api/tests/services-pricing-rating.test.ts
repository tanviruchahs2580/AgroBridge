import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-102 (S1): bookings were priced basePricePaisa × areaBigha for EVERY
 * service, so a PER_SAMPLE lab test or a PER_VISIT agronomist call was billed
 * per bigha. Only PER_BIGHA is area-scaled; every other unit is a flat amount.
 */
describe("Service booking pricing respects priceUnit", () => {
  async function createService(token: string, priceUnit: string, basePricePaisa: number) {
    const res = await request(app)
      .post("/api/v1/services")
      .set("Authorization", `Bearer ${token}`)
      .send({
        code: `TST-${priceUnit.replace(/_/g, "")}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: `Unit test ${priceUnit}`,
        category: "OTHER",
        basePricePaisa,
        priceUnit,
      });
    expect(res.status).toBe(201);
    return res.body.data as { id: string };
  }

  async function book(token: string, farmId: string, serviceId: string, areaBigha: number) {
    return request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, serviceId, scheduledFor: new Date(Date.now() + 86_400_000).toISOString(), areaBigha });
  }

  it("PER_BIGHA still multiplies by area; other units are flat regardless of area", async () => {
    const admin = await getAdmin();
    const f = await registerFarmer();
    const farm = await createFarmWithCrop(f.accessToken);

    const perBigha = await createService(admin.accessToken, "PER_BIGHA", 30_000);
    const perMaund = await createService(admin.accessToken, "PER_MAUND", 12_000);
    const perSample = await createService(admin.accessToken, "PER_SAMPLE", 50_000);
    const perVisit = await createService(admin.accessToken, "PER_VISIT", 80_000);

    const cases: Array<[string, string, number, number]> = [
      [perBigha.id, "PER_BIGHA", 2.5, Math.round(30_000 * 2.5)],
      [perMaund.id, "PER_MAUND", 2.5, 12_000],
      [perSample.id, "PER_SAMPLE", 2.5, 50_000],
      [perVisit.id, "PER_VISIT", 2.5, 80_000],
    ];

    for (const [serviceId, unit, areaBigha, expected] of cases) {
      const res = await book(f.accessToken, farm.farmId, serviceId, areaBigha);
      expect(res.status, `${unit} booking`).toBe(201);
      expect(res.body.data.estimatedPricePaisa, `${unit} response`).toBe(expected);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(row.estimatedPricePaisa, `${unit} persisted`).toBe(expected);
    }
  });

  it("seeded THRESHER (PER_MAUND) is billed once, DRONE_SPRAY (PER_BIGHA) per bigha", async () => {
    const f = await registerFarmer();
    const farm = await createFarmWithCrop(f.accessToken);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const thresher = services.body.data.find((s: { code: string }) => s.code === "THRESHER");
    const drone = services.body.data.find((s: { code: string }) => s.code === "DRONE_SPRAY");

    const thresherBooking = await book(f.accessToken, farm.farmId, thresher.id, 3);
    expect(thresherBooking.status).toBe(201);
    expect(thresherBooking.body.data.estimatedPricePaisa).toBe(thresher.basePricePaisa);

    const droneBooking = await book(f.accessToken, farm.farmId, drone.id, 3);
    expect(droneBooking.status).toBe(201);
    expect(droneBooking.body.data.estimatedPricePaisa).toBe(drone.basePricePaisa * 3);
  });
});

/**
 * AUD-122 (S2): rating was read-then-write on a non-unique Booking.rating and
 * the aggregate increment rode along in a plain transaction array; a repeated
 * or racing submission could inflate ratingCount. Transitions were
 * check-then-write, so two racing transitions could both apply.
 */
describe("Booking rating and transitions are claim-atomic", () => {
  async function bookedWithProvider(token: string) {
    const farm = await createFarmWithCrop(token);
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${token}`);
    const svc = services.body.data.find((s: { code: string }) => s.code === "POWER_TILLER");
    const provider = svc.providers[0];
    const booking = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        farmId: farm.farmId,
        serviceId: svc.id,
        providerId: provider.id,
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        areaBigha: 1,
      });
    expect(booking.status).toBe(201);
    return { bookingId: booking.body.data.id as string, providerId: provider.id as string, providerBefore: provider as { ratingSum: number; ratingCount: number } };
  }

  async function providerAggregates(token: string, serviceCode: "POWER_TILLER", providerId: string) {
    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${token}`);
    const svc = services.body.data.find((s: { code: string }) => s.code === serviceCode);
    return svc.providers.find((p: { id: string }) => p.id === providerId) as { ratingSum: number; ratingCount: number };
  }

  it("double-rating is refused with 409 and the provider aggregate moves exactly once", async () => {
    const f = await registerFarmer();
    const admin = await getAdmin();
    const { bookingId, providerId, providerBefore } = await bookedWithProvider(f.accessToken);

    const completed = await request(app)
      .post(`/api/v1/bookings/${bookingId}/status`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "COMPLETED" });
    expect(completed.status).toBe(200);

    const first = await request(app)
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ rating: 5 });
    expect(first.status).toBe(200);
    expect(first.body.data.rating).toBe(5);

    const second = await request(app)
      .post(`/api/v1/bookings/${bookingId}/rating`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ rating: 1 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");

    const after = await providerAggregates(f.accessToken, "POWER_TILLER", providerId);
    expect(after.ratingCount).toBe(providerBefore.ratingCount + 1);
    expect(after.ratingSum).toBe(providerBefore.ratingSum + 5);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.rating).toBe(5); // the losing submission never overwrote it
  });

  it("racing transitions apply exactly one: one 200, the other 409", async () => {
    const f = await registerFarmer();
    const admin = await getAdmin();
    const { bookingId } = await bookedWithProvider(f.accessToken);

    // Both transitions are legal from ASSIGNED (admin completes, owner cancels);
    // the state machine must admit exactly one.
    const [completed, cancelled] = await Promise.all([
      request(app).post(`/api/v1/bookings/${bookingId}/status`).set("Authorization", `Bearer ${admin.accessToken}`).send({ status: "COMPLETED" }),
      request(app).post(`/api/v1/bookings/${bookingId}/status`).set("Authorization", `Bearer ${f.accessToken}`).send({ status: "CANCELLED", reason: "changed my mind" }),
    ]);

    const statuses = [completed.status, cancelled.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Final state matches the winner, and no second write leaked through.
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const winner = completed.status === 200 ? "COMPLETED" : "CANCELLED";
    expect(row.status).toBe(winner);
    if (winner === "COMPLETED") {
      expect(row.completedAt).toBeTruthy();
      expect(row.cancelReason ?? null).toBeNull();
    } else {
      expect(row.cancelReason).toBe("changed my mind");
    }
  });
});
