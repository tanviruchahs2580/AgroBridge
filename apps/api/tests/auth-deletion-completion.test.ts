import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { app, registerFarmer, createFarmWithCrop } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { getStorageProvider } from "../src/providers/storage/index.js";
import { uploadImage, jpegWithExif } from "./upload-helper.js";

/**
 * AUD-130 residual (B-24): account deletion must finish the job — purge the
 * user's uploaded disease photos, delete OTP challenges for the pre-
 * anonymization phone, clear the location/profile fields the schema has, and
 * still succeed when storage cleanup fails (best-effort, documented).
 *
 * F-12 extension: the farm's location fields, the user's own free text
 * (farm-event title/notes, advisory question/answer) and notification bodies
 * are covered too, because `docs/data-protection.md` and the Play data-safety
 * answers promise exactly that.
 */
describe("account deletion completion (B-24)", () => {
  it("purges uploaded photos, clears OTP + profile fields, kills refresh tokens", async () => {
    const f = await registerFarmer({ fullName: "Delete Complete", password: "DelComplete@1" });

    // Address-like profile fields the schema actually has.
    const patched = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ district: "ঢাকা", upazila: "Savar", address: "House 1, Road 2, Savar" });
    expect(patched.status).toBe(200);
    await prisma.user.update({ where: { id: f.user.id }, data: { region: "DHAKA_NORTH" } });
    await prisma.farmerProfile.update({ where: { userId: f.user.id }, data: { nidLast4: "1234" } });

    // Upload one photo through the real endpoint (stores to local uploads dir).
    const up = await uploadImage(f.accessToken, jpegWithExif(), "image/jpeg", "home.jpg");
    expect(up.status).toBe(201);
    const imagePath = up.body.data.imagePath as string;
    const storedFile = path.resolve(imagePath);
    expect(existsSync(storedFile)).toBe(true);

    // OTP challenge for the pre-anonymization phone.
    const otp = await request(app).post("/api/v1/auth/otp/request").set("Authorization", `Bearer ${f.accessToken}`);
    expect(otp.status).toBe(200);
    expect(await prisma.otpChallenge.count({ where: { phone: f.phone } })).toBe(1);

    const del = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(del.status).toBe(200);
    // Honest completion report: the single upload was purged, none pending.
    expect(del.body.data).toEqual({ deleted: true, uploads: { purged: 1, pendingPurge: 0 } });

    // Photo bytes are gone from the uploads dir.
    expect(existsSync(storedFile)).toBe(false);
    // OTP rows for the phone (and user) are gone.
    expect(await prisma.otpChallenge.count({ where: { OR: [{ userId: f.user.id }, { phone: f.phone }] } })).toBe(0);
    // Refresh token dead.
    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: f.refreshToken });
    expect(refresh.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(0);
    // Profile anonymized + location fields cleared.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id }, include: { farmerProfile: true } });
    expect(stored.phone).toBe(`DEL-${f.user.id}`);
    expect(stored.fullName).toBe("Deleted User");
    expect(stored.region).toBeNull();
    expect(stored.farmerProfile?.address).toBeNull();
    expect(stored.farmerProfile?.district).toBeNull();
    expect(stored.farmerProfile?.upazila).toBeNull();
    expect(stored.farmerProfile?.nidLast4).toBeNull();
  });

  it("still reports deleted:true when storage cleanup fails (best-effort)", async () => {
    const f = await registerFarmer({ password: "DelBestEffort@1" });
    const up = await uploadImage(f.accessToken, jpegWithExif(), "image/jpeg", "keeper.jpg");
    expect(up.status).toBe(201);

    const provider = getStorageProvider();
    const deleteSpy = vi.spyOn(provider, "delete").mockRejectedValueOnce(new Error("storage unreachable"));
    try {
      const del = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
      expect(del.status).toBe(200);
      expect(del.body.data.deleted).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith((up.body.data as { imagePath: string }).imagePath);
      // User is anonymized regardless of the failed purge.
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
      expect(stored.status).toBe("DISABLED");
    } finally {
      deleteSpy.mockRestore();
      // The mocked failure left the file behind on purpose; remove it so this
      // suite's artifact does not outlive the run.
      rmSync(path.resolve((up.body.data as { imagePath: string }).imagePath), { force: true });
    }
  });

  /**
   * F-12: deletion must reach the farm location and the free text the user
   * wrote, not only `User`/`FarmerProfile`. `docs/data-protection.md` and the
   * Play data-safety table both mark farm address/GPS as deletable, and the
   * advisory question is the user's own words.
   */
  it("clears farm geo fields, advisory free text, authored event text and notification bodies", async () => {
    const f = await registerFarmer({ password: "DelGeo@1" });

    const farmRes = await request(app)
      .post("/api/v1/farms")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ name: "Geo Farm", address: "Village Road 7, Savar", district: "ঢাকা", upazila: "Savar", lat: 23.8583, lng: 90.2667, totalAreaBigha: 3 });
    expect(farmRes.status).toBe(201);
    const farmId = farmRes.body.data.id as string;

    const eventRes = await request(app)
      .post(`/api/v1/farms/${farmId}/events`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ type: "OTHER", title: "Called the vet about my cow", notes: "my personal note with a landmark", metadata: { neighbour: "Karim" } });
    expect(eventRes.status).toBe(201);

    const advisory = await prisma.advisoryQuery.create({
      data: { userId: f.user.id, question: "why are my tomatoes dying near my house?", answer: "check the soil", confidence: 0.6, provider: "offline", model: "kb-only", kbVersion: "kb-retrieval-v1" },
    });
    const notification = await prisma.notification.create({
      data: { userId: f.user.id, type: "ORDER", title: "Order confirmed", body: "Deliver to House 1, Road 2, Savar; call 01711111111" },
    });

    const del = await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    // The coordinates and address are gone — the farm row survives for the
    // financial records that reference it.
    const farm = await prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
    expect(farm.lat).toBeNull();
    expect(farm.lng).toBeNull();
    expect(farm.address).toBeNull();
    expect(farm.district).toBeNull();
    expect(farm.upazila).toBeNull();

    // The user's own words are gone from every free-text surface.
    const event = await prisma.farmEvent.findUniqueOrThrow({ where: { id: eventRes.body.data.id as string } });
    expect(event.title).toBe("[removed]");
    expect(event.notes).toBeNull();
    expect(event.metadataStr).toBeNull();
    // Structured, non-personal fields are retained (auditable row).
    expect(event.type).toBe("OTHER");

    const storedAdvisory = await prisma.advisoryQuery.findUniqueOrThrow({ where: { id: advisory.id } });
    expect(storedAdvisory.question).toBe("[removed]");
    expect(storedAdvisory.answer).toBe("[removed]");
    expect(storedAdvisory.kbVersion).toBe("kb-retrieval-v1");

    const storedNotification = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(storedNotification.body).toBe("");

    // No surface still contains the words the user supplied.
    const remaining = await prisma.farmEvent.findMany({ where: { actorId: f.user.id } });
    for (const row of remaining) {
      expect(JSON.stringify(row)).not.toContain("personal note with a landmark");
      expect(JSON.stringify(row)).not.toContain("Karim");
    }
  });

  it("a second user's farm and events are untouched by the first user's deletion", async () => {
    const a = await registerFarmer({ password: "DelGeoA@1" });
    const b = await registerFarmer({ password: "DelGeoB@1" });
    const farmB = await createFarmWithCrop(b.accessToken);
    const before = await prisma.farm.findUniqueOrThrow({ where: { id: farmB.farmId } });

    expect((await request(app).delete("/api/v1/auth/me").set("Authorization", `Bearer ${a.accessToken}`)).status).toBe(200);

    const after = await prisma.farm.findUniqueOrThrow({ where: { id: farmB.farmId } });
    expect(after.lat).toBe(before.lat);
    expect(after.district).toBe(before.district);
    expect(await prisma.farmEvent.count({ where: { farmId: farmB.farmId, actorId: b.user.id } })).toBeGreaterThan(0);
  });
});
