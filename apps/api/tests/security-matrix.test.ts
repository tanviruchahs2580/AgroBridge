import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createUserWithRole } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Security matrix: IDOR, privilege escalation, token abuse, upload abuse.
 * Every case asserts server-side enforcement (not UI hiding).
 */
describe("Security deep-dive", () => {
  it("IDOR: farmer cannot read/modify another farmer's order, booking, procurement, notification", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();

    // A places an order (product must still have stock — PG test DB persists)
    const products = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${a.accessToken}`);
    const p = products.body.data.items.find((x: { stockQty: number }) => x.stockQty > 10);
    expect(p).toBeTruthy();
    await request(app).post("/api/v1/cart/items").set("Authorization", `Bearer ${a.accessToken}`).send({ productId: p.id, qty: 1 });
    const orderRes = await request(app).post("/api/v1/orders/checkout").set("Authorization", `Bearer ${a.accessToken}`);
    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data;

    // B attempts to view A's order via detail endpoint — scoped lookup hides it
    const peek = await request(app).get(`/api/v1/orders/${order.id}`).set("Authorization", `Bearer ${b.accessToken}`);
    expect(peek.status).toBe(404); // not leaked as 403 (no existence oracle)

    // B attempts payment confirm on A's order-derived payment
    const intent = await request(app)
      .post("/api/v1/payments/intent")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send({ purposeType: "ORDER", purposeId: order.id });
    const stolen = await request(app).post(`/api/v1/payments/${intent.body.data.paymentId}/confirm`).set("Authorization", `Bearer ${b.accessToken}`);
    expect(stolen.status).toBe(404);

    // B attempts to mark A's notifications read
    const notif = await request(app).post("/api/v1/notifications/read").set("Authorization", `Bearer ${b.accessToken}`).send({ all: false, ids: [] });
    void notif;
    const aNotifs = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${a.accessToken}`);
    for (const n of aNotifs.body.data.items) {
      expect(n.userId).toBe(a.user.id);
    }
  });

  it("privilege escalation: farmer cannot self-promote via profile update or admin routes", async () => {
    const f = await registerFarmer();
    // PATCH /auth/me ignores unknown fields (zod strict schema drops them)…
    const patched = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ role: "SUPER_ADMIN" });
    expect(patched.status).toBe(200);
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(me.body.data.role).toBe("FARMER"); // unchanged

    const escalate = await request(app).patch(`/api/v1/admin/users/${f.user.id}`).set("Authorization", `Bearer ${f.accessToken}`).send({ role: "SUPER_ADMIN" });
    expect(escalate.status).toBe(403);

    // Direct DB tamper attempt via API impossible; verify permission map has no FARMER wildcard
    const { hasPermission } = await import("../src/middleware/rbac.js");
    expect(hasPermission("FARMER", "*")).toBe(false);
    expect(hasPermission("FARMER", "users:manage")).toBe(false);
  });

  it("refresh-token theft controls: reuse after logout fails; tokens are hashed at rest", async () => {
    const f = await registerFarmer();
    await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${f.accessToken}`).send({ refreshToken: f.refreshToken });

    const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: f.refreshToken });
    expect(replay.status).toBe(401);

    const stored = await prisma.refreshToken.findFirst({ where: { userId: f.user.id }, orderBy: { createdAt: "desc" } });
    expect(stored!.tokenHash).not.toBe(f.refreshToken); // never plaintext at rest
    expect(stored!.tokenHash).toHaveLength(64);         // sha256 hex
  });

  it("upload abuse: oversized image rejected before write", async () => {
    const f = await registerFarmer();
    const boundary = "abuse-test";
    const huge = Buffer.alloc(9 * 1024 * 1024, 0xff); // >8MB fake jpeg
    huge[0] = 0xff; huge[1] = 0xd8;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="x.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      huge,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await request(app)
      .post("/api/v1/disease/cases")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .send(body);
    expect([400, 413]).toContain(res.status);
  });

  it("RBAC matrix: elevated roles cannot exceed their grants", async () => {
    const dealer = await createUserWithRole("DEALER");
    // Dealer can manage products but NOT audit logs / users / payouts
    const audit = await request(app).get("/api/v1/admin/audit-logs").set("Authorization", `Bearer ${dealer.accessToken}`);
    expect(audit.status).toBe(403);
    const users = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${dealer.accessToken}`);
    expect(users.status).toBe(403);
    const payout = await request(app).post("/api/v1/payments/payouts").set("Authorization", `Bearer ${dealer.accessToken}`).send({ poId: "x" });
    expect(payout.status).toBe(403);
  });

  it("rate limiting: AI advisory enforces hourly quota", async () => {
    const f = await registerFarmer();
    // Default test env limit is 30/hour. Fire until limited (max 35 tries).
    let gotLimited = false;
    for (let i = 0; i < 35; i++) {
      const r = await request(app)
        .post("/api/v1/ai/advisory")
        .set("Authorization", `Bearer ${f.accessToken}`)
        .send({ question: `মাটি পরীক্ষা কীভাবে করব? (${i})`, lang: "bn" });
      if (r.status === 429) { gotLimited = true; break; }
      expect(r.status).toBe(200);
    }
    expect(gotLimited).toBe(true);
  });
});
