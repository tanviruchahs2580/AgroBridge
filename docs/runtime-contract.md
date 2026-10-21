# Runtime contract — where the API runs and what it needs (ARC-06)

Status: as-built from the deployed topology (Vercel functions + Neon), with the
measured single-instance behaviour from the 2026-10-21 10k audit. This page is the
pool/instance contract the env knobs hang off.

## Vercel function
- **Region:** single region, `iad1` observed live (AUD-163), co-located with the
  Neon primary — function↔DB latency dominates every request.
- **maxDuration:** platform default. The slowest in-process flows are the login
  bcrypt comparison (~250 ms through the worker pool) and provider calls bounded
  at 8 s (weather/AI) — inside the floor. Raising maxDuration would only prolong
  queueing; refusing surplus work fast is the deliberate policy (overload guard).
- **Cold start:** bounded by the module graph — no synchronous bcrypt at module
  load since 2026-10-21 (it moved into workers), the offline AI KB and weather
  mock keep imports small.

## Database (Neon)
- **Pool:** `DATABASE_CONNECTION_LIMIT` per instance (default cpus×2+1 — 9 on the
  audited box). *Fleet* total = instances × limit must stay inside Neon's
  `max_connections`/pooler ceiling — the number is per INSTANCE, the database
  constraint is global.
- **Pool timeout:** `DATABASE_POOL_TIMEOUT_SECONDS` (default 10 s); exhaustion is
  `503 DB_POOL_EXHAUSTED` + `Retry-After`, never a bare 500.
- Measured under the 10k run: pool peaked at **11 backends with 1–3 active
  queries** — the database was never the bottleneck; the event loop is.

## Instance protections
- `MAX_CONCURRENT_REQUESTS` (default 128) — sizing arithmetic in
  `docs/operations.md`; measured: 198 useful req/s at p50 816 ms under an
  unbounded 1 000-user burst, and past saturation the accept backlog swallows the
  surplus invisibly.
- `SERVER_MAX_CONNECTIONS` — connection-level backstop behind the edge proxy's
  own cap.
- `BCRYPT_POOL_SIZE` (default `min(4, cores−1)`) — login throughput ≈ pool ÷
  cost-12 hash time.

## Measured single instance (2026-10-21, one production-mode container + PostgreSQL 17)
- Sustainable mixed authenticated read load: ~200 req/s; DB pool fine (11
  backends / 1–3 active); event-loop lag p99 12–18 ms idle, sub-second at ceiling.
- 10 000 concurrent sessions: p50 3.1 s served, surplus refused `503 OVERLOADED`,
  **0 5xx** — scaling further = more instances, then Redis for shared limiter
  windows (`docs/operations.md` scaling path).
