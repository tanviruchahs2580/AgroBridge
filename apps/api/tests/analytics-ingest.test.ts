import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * First-party analytics ingest: batch validation and stored rows.
 *
 * Named for the behaviour it guards, not for the round that produced it (F-92).
 */
describe("analytics ingest", () => {
  it("accepts a valid batch with 202 and reports accepted count", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({
        events: [
          { name: "order_completed", sessionId: "s-123", props: { channel: "market" } },
          { name: "wallet_opened" },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.accepted).toBe(2);
    expect(res.body.requestId).toBeDefined();

    // Fire-and-forget rows eventually land.
    await new Promise((r) => setTimeout(r, 150));
    const stored = await prisma.analyticsEvent.count({ where: { userId: f.user.id, name: "order_completed" } });
    expect(stored).toBe(1);
  });

  it("rejects event names outside ^[a-z_]{3,64}$ with 400", async () => {
    const f = await registerFarmer();
    for (const badName of ["BadName", "ok", "has-dash", "UPPER_CASE", "spaces inside"]) {
      const res = await request(app)
        .post("/api/v1/analytics/events")
        .set("Authorization", `Bearer ${f.accessToken}`)
        .send({ events: [{ name: badName }] });
      expect(res.status).toBe(400);
    }
  });

  it("enforces the batch size limit (max 20)", async () => {
    const f = await registerFarmer();
    const flood = Array.from({ length: 21 }, (_, i) => ({ name: `evt_${String(i).padStart(3, "0")}`.slice(0, 64) }));
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ events: flood });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/v1/analytics/events").send({ events: [{ name: "anon_event" }] });
    expect(res.status).toBe(401);
  });
});
