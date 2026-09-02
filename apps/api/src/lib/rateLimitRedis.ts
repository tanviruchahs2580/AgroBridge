import { Redis } from "ioredis";
import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";

/**
 * Multi-instance-safe rate-limit store backed by fixed-window counters in
 * Redis. Enabled automatically when REDIS_URL is configured; otherwise
 * callers keep the default in-memory store (single instance).
 */
export function createRedisStore(redisUrl: string, windowMs?: number): Store {
  const client = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });
  client.on("error", () => {
    // Never crash the app over limiter connectivity — increment() fails open.
  });

  let configuredWindowMs = windowMs;

  async function bump(key: string, winMs: number): Promise<ClientRateLimitInfo> {
    const redisKey = `rl:${key}`;
    const windowSec = Math.ceil(winMs / 1000);
    try {
      const count = await client.incr(redisKey);
      if (count === 1) await client.expire(redisKey, windowSec);
      const ttlSec = await client.ttl(redisKey);
      return {
        totalHits: count,
        resetTime: ttlSec > 0 ? new Date(Date.now() + ttlSec * 1000) : undefined,
      };
    } catch {
      // Redis unavailable: fail open (allow request) — availability beats
      // strict limiting for this product; documented in operations.md.
      return { totalHits: 0, resetTime: undefined };
    }
  }

  return {
    async init(options: Options) {
      if (!configuredWindowMs && options.windowMs) configuredWindowMs = options.windowMs;
    },
    async increment(key: string): Promise<ClientRateLimitInfo> {
      const win = configuredWindowMs ?? 15 * 60_000;
      return await bump(key, win);
    },
    async decrement(key: string): Promise<void> {
      try {
        await client.decr(`rl:${key}`);
      } catch {
        /* ignore */
      }
    },
    async resetKey(key: string): Promise<void> {
      try {
        await client.del(`rl:${key}`);
      } catch {
        /* ignore */
      }
    },
  };
}
