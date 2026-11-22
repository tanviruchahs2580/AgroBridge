import { Redis } from "ioredis";
import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";
import { limiterStoreErrorsTotal } from "../infrastructure/metrics.js";
import { logger } from "../lib/logger.js";

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

/**
 * @param prefix Namespace for this limiter's counters. express-rate-limit hands
 *   the store a key derived only from the request (the keyGenerator's output),
 *   so two limiters sharing a Redis instance would otherwise write the SAME key
 *   and silently share one counter — the per-route budgets documented in
 *   `docs/security.md` would stop meaning what they say. Each limiter passes its
 *   own prefix.
 */
export function createRedisStore(redisUrl: string, windowMs?: number, prefix = "default"): Store {
  const client = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    // A hung limiter must not hang a request: every command gets a bounded
    // window, and when disconnected commands fail immediately instead of
    // queueing — the store fails open (ADR-0010) rather than buffering an
    // unbounded backlog (WP-05 serverless shape; TLS comes from the rediss://
    // URL itself).
    commandTimeout: 2_000,
    enableOfflineQueue: false,
  });
  // Fail-open stays, but it must be observable. The meter lives in the
  // enforcement catch (one failed op = one counted error) because a
  // disconnected client with the offline queue disabled rejects commands
  // client-side without emitting a connection error event; the client error
  // listener below keeps ioredis from crashing the process on idle disconnects.
  let lastErrorLogAt = 0;
  client.on("error", (err) => {
    const now = Date.now();
    if (now - lastErrorLogAt > 60_000) {
      lastErrorLogAt = now;
      logger.warn({ err: err.message }, "rate-limit Redis store error — failing open (ADR-0010)");
    }
  });

  let configuredWindowMs = windowMs;

  /**
   * With the offline queue disabled, a command issued before the socket is
   * ready rejects client-side — right after a cold start every op would fail
   * open and a login burst would count nothing. The first op therefore waits
   * (bounded) for the connection the constructor already started
   * (lazyConnect: false); ioredis dedupes concurrent connect() calls, so
   * racing requests share one wait. A connect that exceeds the window surfaces
   * as the command's own failure — metered fail-open.
   */
  const CONNECT_WAIT_MS = 2_000;
  /**
   * With the offline queue disabled, a command issued before the socket is
   * ready rejects client-side — right after a cold start every op would fail
   * open and a login burst would count nothing. The first op therefore waits
   * (bounded) for the connection the constructor already started. Only a
   * client that actually reports an ioredis connection lifecycle waits: the
   * mocked clients in the unit suite have no `status` and must keep working
   * unchanged (their commands always succeed immediately).
   */
  async function ensureReady(): Promise<void> {
    const status = (client as { status?: unknown }).status;
    if (typeof status !== "string" || status === "ready") return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, CONNECT_WAIT_MS);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        client.removeListener("ready", onReady);
      };
      client.once("ready", onReady);
      // lazyConnect is false, so the constructor is usually already
      // connecting; a client in "wait"/"end" needs an explicit kick, and
      // calling connect() while already connecting throws — the event is the
      // dedupe-safe wait.
      if (status === "wait" || status === "end") client.connect().catch(() => {});
    });
  }

  async function bump(key: string, winMs: number): Promise<ClientRateLimitInfo> {
    const redisKey = `rl:${prefix}:${key}`;
    const windowSec = Math.ceil(winMs / 1000);
    try {
      await ensureReady();
      const result = (await client.eval(BUMP_AND_TTL_LUA, 1, redisKey, String(windowSec))) as [number, number];
      const [count, ttlSec] = result;
      return {
        totalHits: count,
        resetTime: ttlSec > 0 ? new Date(Date.now() + ttlSec * 1000) : undefined,
      };
    } catch (e) {
      // Redis unavailable: fail open (allow request) — availability beats
      // strict limiting for this product; documented in operations.md. Every
      // failed enforcement is metered so a store outage is alertable (WP-05),
      // and logged at most once a minute so an outage is one line per minute,
      // not one per request.
      limiterStoreErrorsTotal.inc({ store: "redis" });
      const now = Date.now();
      if (now - lastErrorLogAt > 60_000) {
        lastErrorLogAt = now;
        logger.warn({ err: (e as Error).message }, "rate-limit Redis store error — failing open (ADR-0010)");
      }
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
        await client.decr(`rl:${prefix}:${key}`);
      } catch {
        /* ignore */
      }
    },
    async resetKey(key: string): Promise<void> {
      try {
        await client.del(`rl:${prefix}:${key}`);
      } catch {
        /* ignore */
      }
    },
  };
}
