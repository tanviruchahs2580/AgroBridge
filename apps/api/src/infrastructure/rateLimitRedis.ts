import { Redis } from "ioredis";
import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";

/**
 * Multi-instance-safe rate-limit store backed by fixed-window counters in
 * Redis. Enabled automatically when REDIS_URL is configured; otherwise
 * callers keep the default in-memory store (single instance — see
 * docs/security.md §Rate limiting for the per-instance budget trade-off and
 * the DB-backed per-account throttle that stays instance-independent).
 */

/**
 * INCR + EXPIRE + TTL in ONE round trip, atomically. The previous
 * incr-then-expire pair was not atomic: a process killed between the two
 * left a TTL-less key whose counter never reset — that account's login
 * bucket stayed rate-limited until someone deleted the key by hand. The
 * `ttl == -1` branch heals exactly those orphans (pre-existing keys that
 * lost their TTL get one re-attached) instead of locking their holders out
 * forever (AUD-V3).
 */
const BUMP_AND_TTL_LUA = `local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if count == 1 or ttl == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}`;

export function createRedisStore(redisUrl: string, windowMs?: number): Store {
  const client = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });
  client.on("error", () => {
    // Never crash the app over limiter connectivity — increment fails open.
  });

  let configuredWindowMs = windowMs;

  async function bump(key: string, winMs: number): Promise<ClientRateLimitInfo> {
    const redisKey = `rl:${key}`;
    const windowSec = Math.ceil(winMs / 1000);
    try {
      const result = (await client.eval(BUMP_AND_TTL_LUA, 1, redisKey, String(windowSec))) as [number, number];
      const [count, ttlSec] = result;
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
    init(options: Options) {
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
