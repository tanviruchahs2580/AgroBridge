import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("Misc hardening — notification preferences & category filters", () => {
  it("preference roundtrip: PATCH persists and GET returns the stored values", async () => {
    const f = await registerFarmer();

    const defaults = await request(app).get("/api/v1/notifications/preferences").set("Authorization", `Bearer ${f.accessToken}`);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data).toEqual({ critical: true, action: true, info: true });

    const patch = await request(app)
      .patch("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ critical: true, action: false, info: true });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toEqual({ critical: true, action: false, info: true });

    const fetched = await request(app).get("/api/v1/notifications/preferences").set("Authorization", `Bearer ${f.accessToken}`);
    expect(fetched.body.data).toEqual({ critical: true, action: false, info: true });
  });

  it("rejects malformed preferences", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .patch("/api/v1/notifications/preferences")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ critical: "yes-please" });
    expect(res.status).toBe(400);
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

describe("Misc hardening — analytics ingest", () => {
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

describe("Misc hardening — error envelope references", () => {
  it("route-level 404 carries an AB-reference support code", async () => {
    const res = await request(app).get("/api/v1/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(res.body.error.reference).toMatch(/^AB-[0-9A-F]{6}$/);
  });

  it("AppError 4xx envelopes carry an AB-reference (401 login + 422 validation)", async () => {
    const unauthorized = await request(app).post("/api/v1/auth/login").send({ phone: "01700000000", password: "Wrong@Pass1" });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.reference).toMatch(/^AB-[0-9A-F]{6}$/);

    const f = await registerFarmer();
    const badWithdrawal = await request(app)
      .post("/api/v1/wallet/withdrawals")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ amountPaisa: -5 });
    expect(badWithdrawal.status).toBe(400);
    expect(badWithdrawal.body.error.reference).toMatch(/^AB-[0-9A-F]{6}$/);

    // References are unique per error occurrence (support correlation aid).
    const again = await request(app).post("/api/v1/auth/login").send({ phone: "01700000000", password: "Wrong@Pass1" });
    expect(again.body.error.reference).not.toBe(unauthorized.body.error.reference);
  });
});

describe("Misc hardening — metrics exposure", () => {
  it("/metrics is reachable without a token outside production", async () => {
    // Guard short-circuits on !isProd, so neither a private source nor a
    // METRICS_TOKEN bearer is required in dev/test environments.
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("agrobridge_http_requests_total");
    expect(res.text).toContain("agrobridge_db_up");
  });
});
