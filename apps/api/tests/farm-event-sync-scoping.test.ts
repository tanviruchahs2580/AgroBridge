import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop } from "./helpers.js";

/**
 * AUD-101 regression: the farm-event sync dedupe lookup is owner-scoped.
 * A global clientUuid lookup once let any authenticated user read another
 * user's event row by replaying its clientUuid against their own farm.
 */
describe("AUD-101: farm-event sync idempotency is owner-scoped", () => {
  it("replays the actor's own event but never echoes another user's row", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    const farmA = await createFarmWithCrop(a.accessToken);
    const farmB = await createFarmWithCrop(b.accessToken);

    const body = { type: "OTHER", title: "Audit event A", clientUuid: crypto.randomUUID() };

    // A creates the event; its own replay is idempotent (same row, 200).
    const created = await request(app)
      .post(`/api/v1/farms/${farmA.farmId}/events`)
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send(body);
    expect(created.status).toBe(201);
    const replayed = await request(app)
      .post(`/api/v1/farms/${farmA.farmId}/events`)
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send(body);
    expect(replayed.status).toBe(200);
    expect(replayed.body.data.id).toBe(created.body.data.id);

    // B submits the SAME clientUuid against B's own farm: the globally-unique
    // uuid collides, but the response must never be A's event row.
    const stolen = await request(app)
      .post(`/api/v1/farms/${farmB.farmId}/events`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ ...body, title: "Injected" });
    expect(stolen.status).toBe(409);
    expect(JSON.stringify(stolen.body)).not.toContain(created.body.data.id);
    expect(JSON.stringify(stolen.body)).not.toContain("Audit event A");

    // B's own event list does not contain A's event.
    const listB = await request(app).get(`/api/v1/farms/${farmB.farmId}/events`).set("Authorization", `Bearer ${b.accessToken}`);
    expect(listB.status).toBe(200);
    expect(listB.body.data.map((e: { id: string }) => e.id)).not.toContain(created.body.data.id);
  });

  it("refuses plot/crop ids that belong to another farm (AUD-101b)", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    const farmA = await createFarmWithCrop(a.accessToken);
    const farmB = await createFarmWithCrop(b.accessToken);

    // B tries to attach A's plot/crop to B's own farm event: rejected, so the
    // event list of B's farm never exposes A's plot name or crop.
    const plot = await request(app)
      .post(`/api/v1/farms/${farmB.farmId}/events`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ type: "OTHER", title: "Cross-farm plot", plotId: farmA.plotId });
    expect(plot.status).toBe(400);

    const cycle = await request(app)
      .post(`/api/v1/farms/${farmB.farmId}/events`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ type: "OTHER", title: "Cross-farm cycle", cropCycleId: farmA.cropId });
    expect(cycle.status).toBe(400);

    // Same-farm ids still work.
    const okRes = await request(app)
      .post(`/api/v1/farms/${farmB.farmId}/events`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ type: "OTHER", title: "Own plot", plotId: farmB.plotId, cropCycleId: farmB.cropId });
    expect(okRes.status).toBe(201);
  });
});
