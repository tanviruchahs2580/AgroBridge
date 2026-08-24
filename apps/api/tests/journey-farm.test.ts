import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop } from "./helpers.js";

/** Journey 2: Create farm → plot → crop; digital record; Journey 13: offline sync idempotency */
describe("Journey 2 & 13 — Farm management + offline sync", () => {
  it("creates farm → plot → crop with automatic lifecycle stage and PLANTING event", async () => {
    const f = await registerFarmer();
    const { farmId, plotId, cropId } = await createFarmWithCrop(f.accessToken);

    expect(farmId).toBeTruthy();
    expect(plotId).toBeTruthy();
    expect(cropId).toBeTruthy();

    const crops = await request(app).get("/api/v1/farms/crops").set("Authorization", `Bearer ${f.accessToken}`);
    expect(crops.status).toBe(200);
    const crop = crops.body.data.find((c: { id: string }) => c.id === cropId);
    expect(crop.stageAuto).toBe("VEGETATIVE"); // planted 30 days ago
    expect(crop.calendar.length).toBeGreaterThan(0);

    // Digital record contains the planting event
    const events = await request(app)
      .get(`/api/v1/farms/${farmId}/events`)
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(events.status).toBe(200);
    expect(events.body.data.some((e: { type: string }) => e.type === "PLANTING")).toBe(true);
  });

  it("rejects second active crop on same plot", async () => {
    const f = await registerFarmer();
    const { plotId } = await createFarmWithCrop(f.accessToken);
    const res = await request(app)
      .post("/api/v1/farms/crops")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ plotId, cropName: "গম", plantedAt: new Date().toISOString() });
    expect(res.status).toBe(409);
  });

  it("enforces ownership: farmer B cannot see/modify farmer A's farm", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    const { farmId } = await createFarmWithCrop(a.accessToken);

    const forbiddenList = await request(app)
      .get(`/api/v1/farms/${farmId}/plots`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(forbiddenList.status).toBe(403);

    const notFoundForB = await request(app)
      .post(`/api/v1/farms/${farmId}/events`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ type: "IRRIGATION", title: "সেচ দেওয়া হলো" });
    expect(notFoundForB.status).toBe(404); // scoped lookup hides other users' resources

    void b.userId;
  });

  it("validates plot area against farm total area", async () => {
    const f = await registerFarmer();
    const { farmId } = await createFarmWithCrop(f.accessToken);
    const res = await request(app)
      .post(`/api/v1/farms/${farmId}/plots`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ name: "বিশাল প্লট", areaBigha: 999 });
    expect(res.status).toBe(400);
  });

  it("offline sync replay with same clientUuid is idempotent", async () => {
    const f = await registerFarmer();
    const { farmId } = await createFarmWithCrop(f.accessToken);
    const clientUuid = "11111111-2222-3333-4444-555555555555";
    const payload = { type: "FERTILIZER", title: "ইউরিয়া প্রয়োগ", clientUuid, metadata: { kg: 50 } };

    const first = await request(app)
      .post(`/api/v1/farms/${farmId}/events`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send(payload);
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post(`/api/v1/farms/${farmId}/events`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);

    const list = await request(app).get(`/api/v1/farms/${farmId}/events`).set("Authorization", `Bearer ${f.accessToken}`);
    const matching = list.body.data.filter((e: { clientUuid?: string }) => e.clientUuid === clientUuid);
    expect(matching).toHaveLength(1);
  });
});
