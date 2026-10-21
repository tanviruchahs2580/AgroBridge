import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { getStorageProvider } from "../src/providers/storage/index.js";
import { uploadImage, jpegWithExif } from "./upload-helper.js";

/**
 * AUD-130 residual (B-24): account deletion must finish the job — purge the
 * user's uploaded disease photos, delete OTP challenges for the pre-
 * anonymization phone, clear the location/profile fields the schema has, and
 * still succeed when storage cleanup fails (best-effort, documented).
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
});
