import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Notification preferences (which categories reach the app badge) and the
 * served notification list/filters.
 *
 * Named for the behaviour it guards, not for the round that produced it (F-92).
 * `hardening-round11` and `misc-hardening` both opened with a preference
 * round-trip; the near-duplicate pair is merged into the first test below, which
 * asserts the union — defaults, PATCH response, and persistence.
 */
describe("notification preferences", () => {
  it("default to deliver-everything, round-trip through PATCH, and persist", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };

    const defaults = await request(app).get("/api/v1/notifications/preferences").set(auth);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data).toEqual({ critical: true, action: true, info: true });

    const patch = await request(app)
      .patch("/api/v1/notifications/preferences")
      .set(auth)
      .send({ critical: true, action: false, info: true });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toEqual({ critical: true, action: false, info: true });

    const after = await request(app).get("/api/v1/notifications/preferences").set(auth);
    expect(after.body.data).toEqual({ critical: true, action: false, info: true });
  });

  it("rejects malformed preferences", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .patch("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ critical: "yes-please" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).patch("/api/v1/notifications/preferences").send({ info: false });
    expect(res.status).toBe(401);
  });
});

describe("notification list", () => {
  it("a user who disabled info keeps a served 200 list", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    await request(app)
      .patch("/api/v1/notifications/preferences")
      .set(auth)
      .send({ critical: true, action: true, info: false });
    const list = await request(app).get("/api/v1/notifications?limit=50").set(auth);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items)).toBe(true);
  });

  it("?category= filters items while counts report unread per category", async () => {
    const f = await registerFarmer();
    await prisma.notification.createMany({
      data: [
        { userId: f.user.id, type: "PAYMENT", category: "CRITICAL", title: "Payment succeeded", body: "b1" },
        { userId: f.user.id, type: "ORDER", category: "CRITICAL", title: "Order paid", body: "b2" },
        { userId: f.user.id, type: "BOOKING", category: "ACTION", title: "Confirm schedule", body: "b3" },
        { userId: f.user.id, type: "SYSTEM", category: "INFO", title: "Tip of the day", body: "b4", readAt: new Date() },
      ],
    });

    const all = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${f.accessToken}`);
    expect(all.status).toBe(200);
    expect(all.body.data.items).toHaveLength(4);
    expect(all.body.data.unread).toBe(3); // one INFO pre-read
    expect(all.body.data.counts).toEqual({ critical: 2, action: 1, info: 0 });

    const criticalOnly = await request(app).get("/api/v1/notifications?category=critical").set("Authorization", `Bearer ${f.accessToken}`);
    expect(criticalOnly.status).toBe(200);
    const items = criticalOnly.body.data.items as { category: string }[];
    expect(items.length).toBeGreaterThan(0);
    for (const n of items) expect(n.category).toBe("CRITICAL");
    // Global unread counters are unaffected by the item filter.
    expect(criticalOnly.body.data.counts).toEqual({ critical: 2, action: 1, info: 0 });
  });
});
