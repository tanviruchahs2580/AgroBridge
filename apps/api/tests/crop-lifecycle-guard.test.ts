import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop } from "./helpers.js";

/**
 * The crop lifecycle is forward-only. HARVESTED and FAILED are terminal:
 * a PATCH may not reopen a finished cycle or rewrite its stage, because the
 * farm record is a ledger of what actually happened in the field. yieldKg
 * stays correctable after harvest (measured-weight fixes) — the guard allows
 * exactly that one field.
 */
describe("crop lifecycle guard (FARM-02)", () => {
  it("ACTIVE → HARVESTED is accepted; reopening and stage rewrites are refused with 409; yield correction still works", async () => {
    const f = await registerFarmer();
    const { cropId } = await createFarmWithCrop(f.accessToken, "ধান", 40);

    const harvested = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ status: "HARVESTED" });
    expect(harvested.status).toBe(200);
    expect(harvested.body.data.status).toBe("HARVESTED");

    const reopened = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ status: "ACTIVE" });
    expect(reopened.status).toBe(409);
    expect(reopened.body.ok).toBe(false);

    const failed = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ status: "FAILED" });
    expect(failed.status).toBe(409);

    const stageRewrite = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ stage: "SEED" });
    expect(stageRewrite.status).toBe(409);

    // Measured-weight correction after harvest is legitimate bookkeeping.
    const corrected = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ yieldKg: 1234, status: "HARVESTED" });
    expect(corrected.status).toBe(200);
    expect(corrected.body.data.yieldKg).toBe(1234);

    // Unauthorized third party still gets not-found, never a conflict leak.
    const other = await registerFarmer();
    const foreign = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${other.accessToken}`)
      .send({ status: "ACTIVE" });
    expect(foreign.status).toBe(404);
  });

  it("a FAILED cycle is equally final", async () => {
    const f = await registerFarmer();
    const { cropId } = await createFarmWithCrop(f.accessToken, "গম", 10);

    const failed = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ status: "FAILED" });
    expect(failed.status).toBe(200);

    const revive = await request(app)
      .patch(`/api/v1/farms/crops/${cropId}`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ status: "ACTIVE" });
    expect(revive.status).toBe(409);
  });
});
