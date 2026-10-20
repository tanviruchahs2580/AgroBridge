import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app, registerFarmer } from "./helpers.js";
import { bcryptCompare, bcryptHash, bcryptPoolStats, shutdownBcryptPool } from "../src/modules/auth/bcryptPool.js";
import { env } from "../src/config/env.js";

/**
 * F-02 / F-11 from the 10k-concurrency audit.
 *
 * Password verification used to run bcryptjs on the event loop: 100 simultaneous
 * logins pinned exactly one core for 77 s (p50 46 s) and an unrelated /health
 * request waited 74 s. These specs pin the two properties that make the fix safe:
 *
 *  - the work goes to the worker pool (not merely "it still works"), because a
 *    pool that silently falls back on every call would pass a functional test and
 *    fix nothing;
 *  - the fallback path is still correct, because it is the safety net that must
 *    hold if a worker cannot start in a given runtime.
 */

afterEach(async () => {
  await shutdownBcryptPool();
});

describe("bcrypt worker pool", () => {
  it("hashes and compares through the pool, producing standard bcrypt output", async () => {
    const hash = await bcryptHash("correct-horse-battery");

    // Format is a data contract: hashes written by the pool must verify with
    // plain bcryptjs (the pre-fix implementation) and vice versa.
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).toHaveLength(60);
    expect(await bcrypt.compare("correct-horse-battery", hash)).toBe(true);
    expect(await bcrypt.compare("wrong", hash)).toBe(false);

    expect(await bcryptCompare("correct-horse-battery", hash)).toBe(true);
    expect(await bcryptCompare("wrong", hash)).toBe(false);

    const stats = bcryptPoolStats();
    expect(stats.pooled).toBeGreaterThanOrEqual(3);
    expect(stats.fallback, "pooled work must not be silently falling back").toBe(0);
    expect(stats.workerFailures).toBe(0);
  });

  it("verifies a hash produced outside the pool (existing rows keep working)", async () => {
    const legacy = bcrypt.hashSync("legacy-password", 4);
    expect(await bcryptCompare("legacy-password", legacy)).toBe(true);
    expect(bcryptPoolStats().pooled).toBeGreaterThan(0);
  });

  it("returns false, never throws, for an unknown account (null hash)", async () => {
    expect(await bcryptCompare("anything", null)).toBe(false);
    // B-05 timing equalisation is the reason this is a comparison and not an
    // early return: it must still have gone through the pool.
    expect(bcryptPoolStats().pooled).toBe(1);
  });

  it("serves the real login route through the pool and keeps the 401 for unknown phones", async () => {
    const f = await registerFarmer();
    const before = bcryptPoolStats().pooled;

    const ok = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(ok.status).toBe(200);

    const unknown = await request(app).post("/api/v1/auth/login").send({ phone: "01799999999", password: "irrelevant" });
    expect(unknown.status).toBe(401);

    expect(bcryptPoolStats().pooled).toBeGreaterThanOrEqual(before + 2);
    expect(bcryptPoolStats().fallback).toBe(0);
  });

  it("stays correct on the in-thread fallback when the pool cannot run", async () => {
    const original = env.BCRYPT_POOL_SIZE;
    (env as { BCRYPT_POOL_SIZE?: number }).BCRYPT_POOL_SIZE = 0; // 0 disables the pool by design
    try {
      const hash = await bcryptHash("fallback-password");
      expect(await bcryptCompare("fallback-password", hash)).toBe(true);
      expect(await bcryptCompare("wrong", hash)).toBe(false);
      expect(await bcryptCompare("anything", null)).toBe(false);

      const stats = bcryptPoolStats();
      expect(stats.unavailable).toBe(true);
      expect(stats.fallback).toBeGreaterThanOrEqual(4);
      expect(stats.pooled).toBe(0);
    } finally {
      (env as { BCRYPT_POOL_SIZE?: number }).BCRYPT_POOL_SIZE = original;
      await shutdownBcryptPool();
    }

    // The pool comes back on the next call, so a transient failure is not sticky.
    const hash = await bcryptHash("after-fallback");
    expect(await bcryptCompare("after-fallback", hash)).toBe(true);
    expect(bcryptPoolStats().pooled).toBeGreaterThan(0);
  });

  it("registration hashes through the pool too", async () => {
    const before = bcryptPoolStats().pooled;
    await registerFarmer();
    expect(bcryptPoolStats().pooled).toBeGreaterThan(before);
    expect(bcryptPoolStats().fallback).toBe(0);
  });
});
