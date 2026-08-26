import { Redis } from "ioredis";
import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";

/**
 * Multi-instance-safe rate-limit store backed by fixed-window counters in
 * Redis. Enabled automatically when REDIS_URL is configured; otherwise
 * callers keep the default in-memory store (single instance).
 */
export function createRedisStore(redisUrl: string): Store {
  const client = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });
  client.on("error", () => {
    // Never crash the app over limiter connectivity — increment() fails open.
  });

  async function bump(key: string, windowMs: number): Promise<ClientRateLimitInfo> {
    const redisKey = `rl:${key}`;
    const windowSec = Math.ceil(windowMs / 1000);
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
    async init(_options: Options) {
      /* nothing to warm up */
    },
    async increment(key: string): Promise<ClientRateLimitInfo> {
      // 15-minute fixed window matches the strictest limiter (auth); the
      // global limiter's window is configured identically via env default.
      return await bump(key, 15 * 60_000);
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
