import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, getAdmin } from "./helpers.js";

/**
 * AUD-116 regression: non-numeric page/pageSize values once flowed into
 * Prisma skip/take as NaN and produced a 500 instead of a 400-style default.
 */
describe("AUD-116: admin audit-log pagination tolerates malformed queries", () => {
  it("clamps non-numeric and oversized page parameters instead of failing", async () => {
    const admin = await getAdmin();
    const bad = await request(app)
      .get("/api/v1/admin/audit-logs?page=abc&pageSize=abc")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(bad.status).toBe(200);
    expect(bad.body.data.page).toBe(1);
    expect(bad.body.data.items.length).toBeLessThanOrEqual(50);

    const huge = await request(app)
      .get("/api/v1/admin/audit-logs?page=-5&pageSize=100000")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(huge.status).toBe(200);
    expect(huge.body.data.page).toBe(1);
    expect(huge.body.data.items.length).toBeLessThanOrEqual(100);
  });
});
