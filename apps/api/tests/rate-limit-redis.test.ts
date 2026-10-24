import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Options } from "express-rate-limit";

/**
 * Unit tests for the Redis-backed rate-limit store (API-8). No real Redis is
 * involved: `ioredis` is replaced with a small in-memory client that mimics
 * INCR/EXPIRE/TTL/DECR/DEL, so the store's contract is asserted
 * deterministically:
 *   - hits are counted per key inside a fixed window (expire only on first hit);
 *   - the window expires and counting restarts;
 *   - a Redis error degrades to the documented fail-open behaviour
 *     (allow the request) instead of throwing into the request path.
 */
const fake = vi.hoisted(() => {
  type Entry = { count: number; expiresAt: number | null };

  /** Minimal in-memory stand-in for the ioredis client. */
  class FakeRedis {
    /** Every client constructed by createRedisStore, in order. */
    static instances: FakeRedis[] = [];
    /** When set, every command rejects with this error (simulated outage). */
    failure: Error | null = null;
    /** Every EXPIRE call, for window assertions. */
    readonly expireCalls: { key: string; seconds: number }[] = [];
    /** Every EVAL that attached a window (the Lua script's EXPIRE branch). */
    readonly evalCalls: { key: string; seconds: number }[] = [];

    private readonly data = new Map<string, Entry>();

    constructor(_url: string, _options?: unknown) {
      FakeRedis.instances.push(this);
    }

    on(_event: string, _listener: (...args: unknown[]) => void): this {
      return this;
    }

    async incr(key: string): Promise<number> {
      this.maybeFail();
      const entry = this.live(key, Date.now());
      const next: Entry = { count: (entry?.count ?? 0) + 1, expiresAt: entry?.expiresAt ?? null };
      this.data.set(key, next);
      return next.count;
    }

    async expire(key: string, seconds: number): Promise<number> {
      this.maybeFail();
      this.expireCalls.push({ key, seconds });
      const entry = this.live(key, Date.now());
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }

    async ttl(key: string): Promise<number> {
      this.maybeFail();
      const entry = this.live(key, Date.now());
      if (!entry) return -2; // key missing / expired, as real Redis reports
      if (entry.expiresAt === null) return -1;
      return Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
    }

    /**
     * Implements the store's BUMP_AND_TTL Lua script with identical
     * semantics: INCR, then EXPIRE only on the first hit OR when the key has
     * no TTL (the orphan-healing branch), returning [count, ttlSeconds].
     */
    async eval(script: string, numKeys: number, key: string, windowSec: string): Promise<[number, number]> {
      void script; // the store sends exactly one script; the fake implements it
      void numKeys;
      this.maybeFail();
      const w = Number(windowSec);
      const now = Date.now();
      const entry = this.live(key, now);
      const count = (entry?.count ?? 0) + 1;
      const ttlNow = !entry ? -2 : entry.expiresAt === null ? -1 : Math.max(0, Math.floor((entry.expiresAt - now) / 1000));
      let expiresAt = entry?.expiresAt ?? null;
      let ttl = ttlNow;
      if (count === 1 || ttlNow === -1) {
        expiresAt = now + w * 1000;
        ttl = w;
        this.evalCalls.push({ key, seconds: w });
      }
      this.data.set(key, { count, expiresAt });
      return [count, ttl];
    }

    async decr(key: string): Promise<number> {
      this.maybeFail();
      const entry = this.live(key, Date.now());
      const next: Entry = { count: (entry?.count ?? 0) - 1, expiresAt: entry?.expiresAt ?? null };
      this.data.set(key, next);
      return next.count;
    }

    async del(key: string): Promise<number> {
      this.maybeFail();
      return this.data.delete(key) ? 1 : 0;
    }

    /** Test helper: current counter value for a redis key, if still live. */
    peek(key: string): number | undefined {
      return this.live(key, Date.now())?.count;
    }

    /** Test helper: seed a TTL-less counter — the pre-Lua orphan shape. */
    seedOrphan(key: string, count: number): void {
      this.data.set(key, { count, expiresAt: null });
    }

    private maybeFail(): void {
      if (this.failure) throw this.failure;
    }

    /** Fetch an entry, dropping it (like Redis) once its TTL has passed. */
    private live(key: string, now: number): Entry | undefined {
      const entry = this.data.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.data.delete(key);
        return undefined;
      }
      return entry;
    }
  }

  return { FakeRedis };
});

vi.mock("ioredis", () => ({ Redis: fake.FakeRedis }));

import { createRedisStore } from "../src/infrastructure/rateLimitRedis.js";

describe("createRedisStore — Redis-backed rate-limit store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    fake.FakeRedis.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts hits per key inside one fixed window, without resetting its TTL", async () => {
    const store = createRedisStore("redis://unused:6379", 60_000);
    expect(fake.FakeRedis.instances).toHaveLength(1);
    const client = fake.FakeRedis.instances[0]!;

    expect((await store.increment("ip:1.2.3.4")).totalHits).toBe(1);
    expect((await store.increment("ip:1.2.3.4")).totalHits).toBe(2);
    expect((await store.increment("ip:1.2.3.4")).totalHits).toBe(3);

    // A different key owns an independent counter.
    expect((await store.increment("ip:5.6.7.8")).totalHits).toBe(1);

    // Counters live under the rl: namespace; the window attaches once, on the
    // first hit (the Lua script's EXPIRE branch — no longer a separate call).
    expect(client.peek("rl:ip:1.2.3.4")).toBe(3);
    expect(client.peek("rl:ip:5.6.7.8")).toBe(1);
    expect(client.evalCalls.filter((c) => c.key === "rl:ip:1.2.3.4")).toEqual([
      { key: "rl:ip:1.2.3.4", seconds: 60 },
    ]);

    const first = await store.increment("ip:9.9.9.9");
    expect(first.resetTime?.getTime()).toBe(Date.now() + 60_000);
  });

  it("takes the window from init() when none was passed to the factory", async () => {
    const store = createRedisStore("redis://unused:6379");
    await store.init!({ windowMs: 30_000 } as Options);

    await store.increment("k");
    expect(fake.FakeRedis.instances[0]!.evalCalls).toEqual([{ key: "rl:k", seconds: 30 }]);
  });

  it("falls back to a 15-minute window before init() runs", async () => {
    const store = createRedisStore("redis://unused:6379");

    await store.increment("k");
    expect(fake.FakeRedis.instances[0]!.evalCalls).toEqual([{ key: "rl:k", seconds: 900 }]);
  });

  /**
   * AUD-V3: a TTL-less key (the crash-between-INCR-and-EXPIRE orphan the old
   * non-atomic pair could leave) gets a window re-attached on its next hit —
   * the account is no longer locked out of its own login bucket forever.
   */
  it("heals a TTL-less orphan key by re-attaching a window", async () => {
    const store = createRedisStore("redis://unused:6379", 60_000);
    const client = fake.FakeRedis.instances[0]!;

    // Simulate the orphan directly: a counter with no expiry.
    client.seedOrphan("rl:orphan", 5);

    const info = await store.increment("orphan");
    expect(info.totalHits).toBe(6);
    expect(info.resetTime?.getTime()).toBe(Date.now() + 60_000); // TTL re-attached
    expect(client.evalCalls).toEqual([{ key: "rl:orphan", seconds: 60 }]);
  });

  it("expires the window: past windowMs the counter restarts at 1 with a fresh TTL", async () => {
    const store = createRedisStore("redis://unused:6379", 60_000);
    await store.increment("k");
    await store.increment("k");
    expect((await store.increment("k")).totalHits).toBe(3);

    // Just before expiry the same window is still live.
    vi.setSystemTime(Date.now() + 59_999);
    expect((await store.increment("k")).totalHits).toBe(4);

    // Past the window Redis drops the key, so counting restarts and the key
    // receives a new TTL rather than inheriting the old one.
    vi.setSystemTime(Date.now() + 2_000);
    const afterExpiry = await store.increment("k");
    expect(afterExpiry.totalHits).toBe(1);
    expect(afterExpiry.resetTime?.getTime()).toBe(Date.now() + 60_000);
  });

  it("decrement and resetKey act on the same namespaced counter", async () => {
    const store = createRedisStore("redis://unused:6379", 60_000);
    const client = fake.FakeRedis.instances[0]!;

    await store.increment("k");
    await store.increment("k");
    await store.decrement("k");
    expect(client.peek("rl:k")).toBe(1);

    await store.resetKey("k");
    expect(client.peek("rl:k")).toBeUndefined();
    expect((await store.increment("k")).totalHits).toBe(1);
  });

  it("fails open on Redis errors instead of throwing into the request path", async () => {
    const store = createRedisStore("redis://unused:6379", 60_000);
    const client = fake.FakeRedis.instances[0]!;
    client.failure = new Error("ECONNREFUSED");

    await expect(store.increment("k")).resolves.toEqual({ totalHits: 0, resetTime: undefined });
    await expect(store.decrement("k")).resolves.toBeUndefined();
    await expect(store.resetKey("k")).resolves.toBeUndefined();

    // Recovery: once Redis is reachable again, counting resumes from 1.
    client.failure = null;
    await expect(store.increment("k")).resolves.toMatchObject({ totalHits: 1 });
  });
});
