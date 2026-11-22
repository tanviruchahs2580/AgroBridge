import { describe, expect, it } from "vitest";
import { createRedisStore } from "../src/infrastructure/rateLimitRedis.js";
import { redisLimiterRequirementProblem } from "../src/config/env.js";
import { registry } from "../src/infrastructure/metrics.js";

/**
 * WP-05 (SEC-07 readiness): the Redis limiter store fails OPEN by decision
 * (ADR-0010) — but a silent fail-open is indistinguishable from a working
 * limiter, so every store error must be metered and logged (throttled), and a
 * deployment that wants the shared store must be able to refuse to boot
 * without it (REQUIRE_REDIS_LIMITER, default off — the owner flips it after
 * OA-03 provisions Redis).
 */

async function counterValue(name: string): Promise<number> {
  const json = (await registry.getMetricsAsJSON()) as { name: string; values: { value: number }[] }[];
  return json.find((m) => m.name === name)?.values.reduce((acc, v) => acc + v.value, 0) ?? 0;
}

describe("Redis limiter store", () => {
  it("fails open when the store is unreachable and meters the failure", async () => {
    const before = await counterValue("agrobridge_limiter_store_errors_total");
    // Port 1 refuses immediately: with the offline queue disabled the command
    // errors instead of queuing, which is the serverless-safe shape.
    const store = createRedisStore("redis://127.0.0.1:1/0", 60_000, "test-failopen");
    const info = await store.increment("k1");
    expect(info.totalHits).toBe(0); // allowed — availability beats strict limiting
    const after = await counterValue("agrobridge_limiter_store_errors_total");
    expect(after).toBeGreaterThan(before);
  });

  it.skipIf(!process.env.TEST_REDIS_URL)("shares one window across two store instances against a live Redis", async () => {
    // Real shared-store proof: two stores (two instances) on one Redis must
    // count into the same bucket. Neither compose file has a redis service, so
    // provide a disposable one:
    //   docker run --rm -d --name agrobridge-test-redis -p 127.0.0.1:6380:6379 redis:7-alpine
    //   TEST_REDIS_URL=redis://127.0.0.1:6380/15 npx vitest run tests/redis-limiter.test.ts
    // CI has no Redis service (recorded, E6) — the skip above is the documented
    // precondition, and the runbook carries the local proof procedure.
    if (!process.env.TEST_REDIS_URL) {
      throw new Error("TEST_REDIS_URL not set — run against the compose redis per docs/runbooks/redis-limiter.md");
    }
    const prefix = `test-share-${Date.now()}`; // ONE namespace for both stores
    const a = createRedisStore(process.env.TEST_REDIS_URL, 60_000, prefix);
    const b = createRedisStore(process.env.TEST_REDIS_URL, 60_000, prefix);
    await a.resetKey("shared");
    await a.increment("shared");
    await a.increment("shared");
    const fromB = await b.increment("shared");
    expect(fromB.totalHits).toBe(3);
  });

  it("resetKey and decrement are safe when the store is down", async () => {
    const store = createRedisStore("redis://127.0.0.1:1/0", 60_000, "test-safety");
    await expect(store.decrement("k")).resolves.toBeUndefined();
    await expect(store.resetKey("k")).resolves.toBeUndefined();
  });
});

describe("REQUIRE_REDIS_LIMITER guard", () => {
  it("refuses production without REDIS_URL only when the requirement is set", () => {
    expect(redisLimiterRequirementProblem({ NODE_ENV: "production", REQUIRE_REDIS_LIMITER: "1", REDIS_URL: undefined })).toMatch(/REDIS_URL/);
    expect(redisLimiterRequirementProblem({ NODE_ENV: "production", REQUIRE_REDIS_LIMITER: "1", REDIS_URL: "" })).toMatch(/REDIS_URL/);
    expect(redisLimiterRequirementProblem({ NODE_ENV: "production", REQUIRE_REDIS_LIMITER: "1", REDIS_URL: "rediss://x" })).toBeNull();
  });

  it("stays off by default and outside production", () => {
    // Default off: the owner flips it after OA-03, never the code.
    expect(redisLimiterRequirementProblem({ NODE_ENV: "production", REQUIRE_REDIS_LIMITER: undefined, REDIS_URL: undefined })).toBeNull();
    expect(redisLimiterRequirementProblem({ NODE_ENV: "production", REQUIRE_REDIS_LIMITER: "0", REDIS_URL: undefined })).toBeNull();
    expect(redisLimiterRequirementProblem({ NODE_ENV: "development", REQUIRE_REDIS_LIMITER: "1", REDIS_URL: undefined })).toBeNull();
  });
});
