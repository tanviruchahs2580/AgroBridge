import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, getAdmin, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * F-04: three routes parsed query strings by hand (String-casing, Number()
 * coercion, `includes()` fallbacks). They now go through validate({ query })
 * with explicit schemas. These tests pin the two behaviours that changed:
 * unknown filter values are rejected with 400 instead of silently degrading
 * ("unknown status" → all rows), and the audit-log filters the indexes already
 * support actually filter. Each worker seeds its own fixture rows — tests run
 * against separate DBs, so no cross-file seeding is assumed.
 */
describe("F-04 — schema-validated list queries", () => {
  it("GET /admin/audit-logs filters by entityType and actorId; malformed pagination still clamps (AUD-116)", async () => {
    const admin = await getAdmin();
    const auth = { Authorization: `Bearer ${admin.accessToken}` };

    // Self-seeded rows with a unique entityType — the filter returns only
    // these, proving the where-clause is real (index: @@index([entityType, entityId])).
    await prisma.auditLog.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        actorId: admin.userId,
        action: "QUERY_VALIDATION_FIXTURE",
        entityType: "QueryValidationFixture",
        entityId: `f-${i}`,
      })),
    });

    const byType = await request(app).get("/api/v1/admin/audit-logs?entityType=QueryValidationFixture").set(auth);
    expect(byType.status).toBe(200);
    const items = byType.body.data.items as { entityType: string | null }[];
    expect(items.length).toBe(3);
    for (const item of items) expect(item.entityType).toBe("QueryValidationFixture");

    // actorId filter (index: @@index([actorId])) — every row is the admin's.
    const byActor = await request(app).get(`/api/v1/admin/audit-logs?actorId=${admin.userId}`).set(auth);
    expect(byActor.status).toBe(200);
    for (const item of byActor.body.data.items as { actorId: string | null }[]) {
      expect(item.actorId).toBe(admin.userId);
    }

    // Filter + pagination metadata agree.
    expect(byType.body.data.total).toBe(3);
    expect(byType.body.data.totalPages).toBe(1);

    // AUD-116 preserved through the schema: page=0 clamps to 1, still 200.
    const bad = await request(app).get("/api/v1/admin/audit-logs?page=0&pageSize=abc").set(auth);
    expect(bad.status).toBe(200);
    expect(bad.body.data.page).toBe(1);
  });

  it("GET /admin/withdrawals rejects unknown status with 400 instead of returning all rows", async () => {
    const admin = await getAdmin();
    const auth = { Authorization: `Bearer ${admin.accessToken}` };

    // The old handler treated an unknown status as "no filter" — every
    // withdrawal of every status came back. Now it fails loud.
    const unknown = await request(app).get("/api/v1/admin/withdrawals?status=EXPIRED").set(auth);
    expect(unknown.status).toBe(400);

    // Known statuses still work, in any case.
    const pending = await request(app).get("/api/v1/admin/withdrawals?status=pending").set(auth);
    expect(pending.status).toBe(200);
    for (const w of pending.body.data as { status: string }[]) expect(w.status).toBe("PENDING");
  });

  it("GET /notifications rejects unknown category with 400 instead of returning the unfiltered list", async () => {
    const farmer = await registerFarmer();
    const auth = { Authorization: `Bearer ${farmer.accessToken}` };

    const unknown = await request(app).get("/api/v1/notifications?category=billing").set(auth);
    expect(unknown.status).toBe(400);

    const critical = await request(app).get("/api/v1/notifications?category=Critical").set(auth);
    expect(critical.status).toBe(200);
    for (const n of critical.body.data.items as { category: string }[]) expect(n.category).toBe("CRITICAL");
  });
});
