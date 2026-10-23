import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * AUD-V3: the retention policy finally has a production schedule — the Vercel
 * cron in apps/api/vercel.json hits GET /api/v1/ops/retention daily. That
 * endpoint is a data-deletion surface, so these tests pin its guard: the cron
 * secret (set in tests/setup-env.ts) is compared in a way that neither reveals
 * nor accepts anything else, and a valid invocation both applies the policy
 * and leaves an audit row.
 */

describe("GET /api/v1/ops/retention — cron-guarded data retention", () => {
  it("rejects anonymous callers with 403", async () => {
    const res = await request(app).get("/api/v1/ops/retention");
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it("rejects a wrong bearer token with 403", async () => {
    const res = await request(app).get("/api/v1/ops/retention").set("Authorization", "Bearer not-the-secret");
    expect(res.status).toBe(403);
  });

  it("runs the policy with the correct secret and audits the run", async () => {
    // One row inside every window means a clean run deletes nothing — the
    // assertion is about the endpoint contract, not the policy's arithmetic
    // (tests/retention-job.test.ts owns that).
    const before = await prisma.auditLog.count({ where: { action: "RETENTION_JOB_RUN" } });
    const res = await request(app).get("/api/v1/ops/retention").set("Authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
    expect(res.body.data.ran).toBe(true);
    expect(res.body.data).toHaveProperty("refreshTokens");
    expect(res.body.data).toHaveProperty("analyticsEvents");
    expect(res.body.data).toHaveProperty("notifications");
    expect(res.body.data).toHaveProperty("aiUsageLogs");
    expect(res.body.data).toHaveProperty("advisoryQueries");
    const after = await prisma.auditLog.count({ where: { action: "RETENTION_JOB_RUN" } });
    expect(after).toBe(before + 1);
  });

  it("is not discoverable by farmers (same guard, role is irrelevant)", async () => {
    const { registerFarmer } = await import("./helpers.js");
    const f = await registerFarmer();
    const res = await request(app).get("/api/v1/ops/retention").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(403);
  });
});
