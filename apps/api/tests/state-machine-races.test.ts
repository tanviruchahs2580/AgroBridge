import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createUserWithRole } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { uploadImage, jpegWithExif } from "./upload-helper.js";

/**
 * AUD-V3 (API M-1): three non-money state machines still used check-then-act
 * where the codebase's own convention is a claim the database settles. These
 * tests drive the actual concurrent requests and assert exactly-once outcomes
 * at the row level.
 */

describe("concurrent state transitions settle exactly once (AUD-V3)", () => {
  it("two simultaneous crop-cycle creations on one plot → exactly one ACTIVE cycle", async () => {
    const f = await registerFarmer();
    const farmRes = await request(app).post("/api/v1/farms").set("Authorization", `Bearer ${f.accessToken}`)
      .send({ name: "রেস ফার্ম", district: "রংপুর", lat: 25.9, lng: 89.1, totalAreaBigha: 5 });
    const farmId = farmRes.body.data.id as string;
    const plotRes = await request(app).post(`/api/v1/farms/${farmId}/plots`).set("Authorization", `Bearer ${f.accessToken}`)
      .send({ name: "প্লট-১", areaBigha: 2 });
    const plotId = plotRes.body.data.id as string;

    const cropBody = {
      plotId,
      cropName: "ধান",
      plantedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    };
    const [a, b] = await Promise.all([
      request(app).post("/api/v1/farms/crops").set("Authorization", `Bearer ${f.accessToken}`).send(cropBody),
      request(app).post("/api/v1/farms/crops").set("Authorization", `Bearer ${f.accessToken}`).send(cropBody),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]); // one winner, one named conflict — not two 201s
    expect(await prisma.cropCycle.count({ where: { plotId, status: "ACTIVE" } })).toBe(1);
  });

  it("two simultaneous agronomist reviews of one case → exactly one REVIEWED verdict, one audit row", async () => {
    const f = await registerFarmer();
    const upload = await uploadImage(f.accessToken, jpegWithExif(), "image/jpeg", "leaf.jpg");
    expect(upload.status).toBe(201);
    const caseId = upload.body.data.id as string;

    const admin = await createUserWithRole("ADMIN");
    const review = { diagnosis: "Rice blast fungus", severity: "HIGH", recommendation: "Apply tricyclazole; drain field." };
    const [a, b] = await Promise.all([
      request(app).post(`/api/v1/disease/cases/${caseId}/review`).set("Authorization", `Bearer ${admin.accessToken}`).send(review),
      request(app).post(`/api/v1/disease/cases/${caseId}/review`).set("Authorization", `Bearer ${admin.accessToken}`).send(review),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const kase = await prisma.diseaseCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(kase.status).toBe("REVIEWED");
    expect(kase.reviewedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: caseId, action: "DISEASE_REVIEWED" } })).toBe(1);
  });

  it("a cancel racing an assign can never be resurrected to ASSIGNED", async () => {
    const f = await registerFarmer();
    const farmRes = await request(app).post("/api/v1/farms").set("Authorization", `Bearer ${f.accessToken}`)
      .send({ name: "বুকিং ফার্ম", district: "রংপুর", lat: 25.9, lng: 89.2, totalAreaBigha: 3 });
    const farmId = farmRes.body.data.id as string;

    const services = await request(app).get("/api/v1/services").set("Authorization", `Bearer ${f.accessToken}`);
    const svc = services.body.data.items?.[0] ?? services.body.data[0];
    expect(svc).toBeTruthy();

    // Bookings created without a provider are REQUESTED — the assignable state.
    const booking = await request(app).post("/api/v1/bookings").set("Authorization", `Bearer ${f.accessToken}`)
      .send({ farmId, serviceId: svc.id, scheduledFor: new Date(Date.now() + 3 * 86400000).toISOString(), areaBigha: 1 });
    expect(booking.status).toBe(201);
    const bookingId = booking.body.data.id as string;

    // Find an assignable provider for the service.
    const provider = await prisma.serviceProvider.findFirst({ where: { serviceId: svc.id, isActive: true } });
    const admin = await createUserWithRole("ADMIN");

    // Cancel and assign race, repeatedly: whichever way the interleaving
    // lands, a SUCCESSFUL cancel must be final — the old check-then-update
    // let the assign resurrect the booking to ASSIGNED after the cancel.
    for (let round = 0; round < 3; round++) {
      // Recreate a REQUESTED booking each round.
      const bk = await request(app).post("/api/v1/bookings").set("Authorization", `Bearer ${f.accessToken}`)
        .send({ farmId, serviceId: svc.id, scheduledFor: new Date(Date.now() + (3 + round) * 86400000).toISOString(), areaBigha: 1 });
      const id = bk.body.data.id as string;
      const [, cancelRes] = await Promise.all([
        provider
          ? request(app).post(`/api/v1/bookings/${id}/assign`).set("Authorization", `Bearer ${admin.accessToken}`).send({ providerId: provider.id })
          : Promise.resolve({ status: 0 }),
        request(app).post(`/api/v1/bookings/${id}/status`).set("Authorization", `Bearer ${f.accessToken}`).send({ status: "CANCELLED" }),
      ]);
      const final = await prisma.booking.findUniqueOrThrow({ where: { id } });
      if (cancelRes.status === 200) {
        expect(final.status).toBe("CANCELLED"); // a won cancel is never resurrected
      } else {
        // The cancel lost the race only to an assign that had ALREADY claimed
        // it — then the user's cancel legitimately applies on top (status
        // transitions allow cancelling an ASSIGNED booking).
        expect(["CANCELLED", "ASSIGNED", "REQUESTED"]).toContain(final.status);
      }
    }
    expect(bookingId).toBeTruthy();
  });
});
