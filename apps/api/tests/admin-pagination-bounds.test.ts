import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, getAdmin } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-116 regression: non-numeric page/pageSize values once flowed into
 * Prisma skip/take as NaN and produced a 500 instead of a 400-style default.
 *
 * This used to assert only `items.length <= 100` / `<= 50` — an under-returning
 * regression (a clamp that started truncating below the cap, or a route that
 * returned an empty page) passed. The rows below are seeded so `auditLog.count()`
 * is large enough for the returned page to be EXACTLY the clamped size.
 */
describe("AUD-116: admin audit-log pagination tolerates malformed queries", () => {
  const SEEDED_ROWS = 105; // above both caps under test (50 default, 100 max)

  beforeAll(async () => {
    const admin = await getAdmin();
    await prisma.auditLog.createMany({
      data: Array.from({ length: SEEDED_ROWS }, (_, i) => ({
        actorId: admin.userId,
        action: "PAGINATION_FIXTURE",
        entityType: "QaFixture",
        entityId: `fixture-${i}`,
      })),
    });
  });

  it("clamps non-numeric and oversized page parameters instead of failing", async () => {
    const admin = await getAdmin();
    const bad = await request(app)
      .get("/api/v1/admin/audit-logs?page=abc&pageSize=abc")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(bad.status).toBe(200);
    expect(bad.body.data.page).toBe(1);
    // pageSize=abc falls back to the 50 default — exactly, not "at most".
    expect(bad.body.data.items.length).toBe(50);

    const huge = await request(app)
      .get("/api/v1/admin/audit-logs?page=-5&pageSize=100000")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(huge.status).toBe(200);
    expect(huge.body.data.page).toBe(1);
    // pageSize=100000 clamps to 100 — exactly.
    expect(huge.body.data.items.length).toBe(100);

    // The metadata agrees with the page that was served, so the caller can page on.
    expect(huge.body.data.total).toBeGreaterThanOrEqual(SEEDED_ROWS);
    expect(huge.body.data.totalPages).toBe(Math.max(1, Math.ceil(huge.body.data.total / 100)));
  });
});
