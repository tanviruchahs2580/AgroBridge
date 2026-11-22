# Runbook — the shared rate-limiter store (Redis) — OA-03

The limiter store fails **open** by decision (ADR-0010): when Redis is unreachable every request is
allowed and the failure is metered (`agrobridge_limiter_store_errors_total{store="redis"}`) and
logged at most once per minute. Provisioning Redis is safe for the auth limiters (they stopped
sharing one store instance in PR #81) and turns the documented per-instance quota
`(instances × configured max)` into the real quota. The commandTimeout is bounded (2 s) and the
offline queue is disabled — a limiter outage must never hang a request or buffer an unbounded
backlog; TLS comes from the `rediss://` URL itself.

## 1. Provisioning — [owner]

1. Choose a Redis co-located with the API functions (same region — `iad1` per ADR-0018; Upstash or
   Elasticache both work). Serverless-friendly: TLS endpoint, per-command timeout, no eviction of
   keys we still need.
2. Eviction policy: the store keeps only short-TTL counters (`rl:<limiter>:<key>`), so
   **`volatile-ttl`** is the suited policy — under memory pressure Redis evicts the counter closest
   to expiry, which weakens the least-urgent window first. `noeviction` would error writes at the
   cap (fail-open anyway, but loudly); `allkeys-*` may evict non-TTL keys in a shared instance.
3. Sizing: counters are tiny (few bytes × distinct keys × limiters). The driver is key count: worst
   case = distinct client keys per 15-min window × the number of limiters (~10). 10–50 MB is ample
   to start; alert on `redis_memory_used_bytes` approaching the cap.
4. Set `REDIS_URL` (a `rediss://` URL for TLS) on the API deployment env. Restart.

## 2. Verification after provisioning

1. `/ready` must report `"limiterStore": "redis"` (it reports `memory` today — `docs/STATUS.md`).
2. The gauge must agree: `agrobridge_limiter_store_info{store="redis"} 1` in `/metrics` (a process
   still on memory windows fires the `ProductionMemoryLimiter` alert rule instead of a JSON field
   nobody scrapes).
3. Shared-window proof: `apps/api/tests/redis-limiter.test.ts` runs two store instances against a
   live Redis and asserts one shared bucket. Neither compose file carries a Redis service, so run a
   disposable one:
   `docker run --rm -d --name agrobridge-test-redis -p 127.0.0.1:6380:6379 redis:7-alpine`
   then, from `apps/api/`:
   `TEST_REDIS_URL=redis://127.0.0.1:6380/15 npx vitest run tests/redis-limiter.test.ts`
   (`docker rm -f agrobridge-test-redis` afterwards).
4. Once it is live, set `REQUIRE_REDIS_LIMITER=1` on the deployment: production then **refuses to
   boot** without `REDIS_URL`, so a future deploy cannot silently regress to per-instance windows.
   Default is off — the owner flips it (OA-03), never the code.

## 3. When the alert fires (`LimiterStoreErrors`)

1. Every request is currently being allowed (ADR-0010 fail-open) — the API keeps serving; no user
   action needed.
2. Check the store: connectivity from the functions (same region? TLS cert valid? plan limits hit?),
   `redis_memory_used_bytes` vs cap, and the one-line-per-minute API log
   (`rate-limit Redis store error — failing open (ADR-0010)`).
3. After the store recovers the counters restart from zero — windows reset; do not "backfill".

## 4. What this does NOT cover

- The DB-backed per-account throttle (login attempt counters) is instance-independent by design and
  unaffected.
- The webhook's dedicated flood limiter namespaces its keys (`payments-webhook`) and follows the
  same fail-open rule — a Redis outage does NOT open the webhook to unlimited floods beyond the
  per-instance memory limiter fallback each limiter keeps.
