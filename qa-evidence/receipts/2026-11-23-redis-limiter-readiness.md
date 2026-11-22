# WP-05 — Redis limiter readiness, 2026-11-23

Machine: Windows 11, Git Bash, Node v24.19.0 (project pins 22 — unavailable here; CI is the
transferable run). Branch `feat/redis-limiter-readiness` off `main` @ `04b987f`.

## What changed

- Store hardening (`infrastructure/rateLimitRedis.ts`): bounded `commandTimeout` (2 s), offline
  queue disabled (no unbounded backlog while disconnected), a bounded wait-for-ready on the first
  op after a cold start, every failed enforcement metered, store errors logged at most once per
  minute. Fail-open semantics unchanged (ADR-0010).
- Boot gauge `agrobridge_limiter_store_info{store}` + counter `agrobridge_limiter_store_errors_total{store}`
  (`infrastructure/metrics.ts`); app.ts sets the gauge where `limiterStore` is computed.
- `REQUIRE_REDIS_LIMITER` (enum 0/1, optional, default off): `redisLimiterRequirementProblem` in
  `config/env.ts` refuses a production boot without `REDIS_URL` only when the operator sets `1`.
- Alert rules + promtool rule tests: `LimiterStoreErrors` (sustained store failures) and
  `ProductionMemoryLimiter` (a process on memory windows) — firing and quiet paths both asserted.
- Runbooks: `docs/runbooks/redis-limiter.md` (provisioning, `volatile-ttl` rationale, sizing,
  verification, alert response), `docs/runbooks/edge-protection.md` (WAF/bot rule *specification*
  for OA-04 — nothing applied by engineering).
- Docs: `.env.example`, `docs/env-reference.md` (regenerated via
  `node apps/api/scripts/generate-env-reference.mjs`), `docs/runtime-contract.md` topology row +
  known-limitations note.

## Evidence (commands run on this branch)

- Test-first: `tests/redis-limiter.test.ts` failed before the metric/guard existed (2 failed); after
  implementation **4 passed / 1 skipped** without a Redis, **5 passed** with one:
  `TEST_REDIS_URL=redis://127.0.0.1:6380/15 npx vitest run tests/redis-limiter.test.ts` against a
  disposable `redis:7-alpine` container (removed afterwards). CI has no Redis service — the shared-
  window case is an explicit, documented skip there (E6; the substitute evidence is this run).
- promtool rule tests: `docker run --rm -v "$PWD/monitoring:/m:ro" --entrypoint promtool
  prom/prometheus:v3.15.0 test rules /m/alert_rules.test.yml` → **SUCCESS** (includes the 3 new
  WP-05 cases).
- `npm run typecheck` exit 0; link-check clean; check-versions clean.
- Full API suite on the branch: see the PR (CI runs both engine profiles; local run recorded in the
  PR body).

## Deviations

- The two-process shared-window proof runs two *store instances*, not two full API processes — the
  limiter keys are the sharing boundary, so one namespace asserted across two clients proves the
  property the WP asked for without booting two servers.
- Node v24 locally (pin 22 unavailable); disk pressure persists on C: (cleaned caches at session
  start).
