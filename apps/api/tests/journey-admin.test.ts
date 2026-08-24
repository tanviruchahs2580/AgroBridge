import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";

/** Journey 10/11/12: admin control tower, RBAC enforcement, notifications */
describe("Journey 10 — Admin control tower", () => {
  it("metrics map to real data and are farmer-visible-blocked", async () => {
    const f = await registerFarmer();
    const admin = await getAdmin();

    const farmerBlocked = await request(app).get("/api/v1/admin/metrics").set("Authorization", `Bearer ${f.accessToken}`);
    expect(farmerBlocked.status).toBe(403);

    const res = await request(app).get("/api/v1/admin/metrics").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    for (const key of ["farmers", "activeFarmers", "farms", "orders", "bookings", "revenuePaisa"]) {
      expect(res.body.data[key]).toBeTypeOf("number");
    }
    expect(res.body.data.farmers).toBeGreaterThanOrEqual(1);
  });

  it("user list with search + pagination; suspend revokes sessions", async () => {
    const admin = await getAdmin();
    const f = await registerFarmer();

    const search = await request(app)
      .get(`/api/v1/admin/users?search=${encodeURIComponent(f.phone)}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(search.status).toBe(200);
    expect(search.body.data.total).toBe(1);

    const suspended = await request(app)
      .patch(`/api/v1/admin/users/${f.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(suspended.status).toBe(200);

    // Suspended user's access token no longer works on protected routes
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(me.status).toBe(401);

    // Admin cannot self-suspend
    const selfSuspend = await request(app)
      .patch(`/api/v1/admin/users/${admin.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(selfSuspend.status).toBe(400);
  });

  it("audit log records security-relevant events", async () => {
    const f = await registerFarmer();
    const admin = await getAdmin();
    await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });

    const res = await request(app).get("/api/v1/admin/audit-logs?pageSize=50").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    const actions = res.body.data.items.map((i: { action: string }) => i.action);
    expect(actions).toContain("AUTH_REGISTER");
    expect(actions).toContain("AUTH_LOGIN");
  });

  it("audit-logs blocked without permission even for elevated-but-wrong roles", async () => {
    const { createUserWithRole } = await import("./helpers.js");
    const manager = await createUserWithRole("PROCUREMENT_MANAGER"); // lacks audit:read
    const res = await request(app).get("/api/v1/admin/audit-logs").set("Authorization", `Bearer ${manager.accessToken}`);
    expect([403, 404]).toContain(res.status); // 403 by RBAC guard
  });

  it("ai usage telemetry aggregates per provider", async () => {
    const admin = await getAdmin();
    const res = await request(app).get("/api/v1/admin/ai-usage").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty("provider");
      expect(res.body.data[0].count).toBeGreaterThan(0);
    }
  });
});

describe("Journey 12 — Notifications", () => {
  it("order events generate notifications; unread count works; mark-read works", async () => {
    const f = await registerFarmer();

    const before = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${f.accessToken}`);

    // Trigger a notification via checkout flow
    const products = await request(app).get("/api/v1/products?pageSize=5").set("Authorization", `Bearer ${f.accessToken}`);
    const p = products.body.data.items[0];
    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${f.accessToken}`).send({ productId: p.id, qty: 1 });
    const order = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${f.accessToken}`);

    const after = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${f.accessToken}`);
    expect(after.body.data.items.length).toBeGreaterThan(before.body.data.items.length);
    expect(after.body.data.unread).toBeGreaterThan(0);
    expect(after.body.data.items.some((n: { refId?: string }) => n.refId === order.body.data.id)).toBe(true);

    const markRead = await request(app)
      .post("/api/v1/notifications/read")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ all: true });
    expect(markRead.status).toBe(200);

    const final = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${f.accessToken}`);
    expect(final.body.data.unread).toBe(0);
  });

  it("users cannot see others' notifications", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    const listA = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${a.accessToken}`);
    for (const item of listA.body.data.items) {
      expect(item.userId).not.toBe(b.user.id);
    }
  });
});
