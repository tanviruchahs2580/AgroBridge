# Receipt — 10k-concurrency load simulation and current-condition QA

**Date:** 2026-10-21
**Commit under test:** `0ce54b59a93657df3c9292db47cd2821f8d8136c` (`main`, "fix(web): post-deletion
logout no longer paints a misleading session-expired toast (#39)")
**Machine:** Windows 11 (10.0.26300), 4 physical / 8 logical cores, 7.5 GB RAM
(**206 MB available during the run**; Windows memory compression at 2.75 GB), Docker Desktop 29.7.2,
Node 24.19.0 on the host / Node 22 in the image.
Full narrative and findings: `docs/qa/2026-10-21-load-10k-and-condition-report.md`.

## Command

```bash
# current-condition gates
npm run typecheck                                    # api + web
npm run test --workspace apps/web                     # 161 unit tests
npm run lint --workspace apps/web && npm run i18n:check --workspace apps/web
npm run build --workspace apps/web && npm run preflight --workspace apps/web
# API suite on PostgreSQL 17 from the production migration chain, inside the repo's own image
docker build --target build -f docker/api.Dockerfile -t agrobridge-api:qa10k-build .
docker run --rm --network agro-qa-net -e DATABASE_URL=postgresql://…@agro-qa-pg:5432/agrobridge_qa_test \
  -v <repo>/.env.example:/app/.env.example:ro -v <repo>/contracts:/app/contracts:ro -v <repo>/docs:/app/docs:ro \
  agrobridge-api:qa10k-build sh -c "node scripts/provision-postgres.mjs && npx vitest run --config vitest.config.pg.ts"
# load simulation (harness in qa-evidence/load10k/, run inside the container network)
node run-load.mjs --config=pass-10k.json --label=10k
node storm.mjs --mode=login --concurrency=100
node storm.mjs --mode=weather --cold --concurrency=1000
node cpu-profile.mjs --n=250 --concurrency=8
```

## Headline result

| Gate | Result |
|---|---|
| API suite, PostgreSQL 17, production migration chain | **342 passed / 342** (57 files) |
| Web unit | **161 passed / 161** (16 files) |
| typecheck / lint / i18n / build / preflight | **all pass** (entry 142.4 kB gzip of 150 kB budget) |
| **10 000 concurrent virtual users** vs one production-mode instance | **100 910 requests, 210 req/s served of ~500 offered, p50 9 721 ms, p95 56 617 ms, p99 59 323 ms, 44 516 requests (44 %) over 30 s, 204 reset, 1 063 `429`, 0 `5xx`** |
| **100 simultaneous logins** (bcrypt cost 12) | **p50 46.4 s, p95 76.3 s, 1.3 logins/s, 106 % of one core, event-loop lag 5 792 ms** |
| **1 000 simultaneous cold-cache weather requests** | p50 5 270 ms, **+12.66 CPU-s vs +7.35 warm** (+5.3 CPU-s/1 000 = the provider work no coalescing removes) |
| Per-request CPU | `/health` 3.9 ms vs authenticated DB routes **13.5–18.4 ms**; autocannon `/health` 1 433 req/s vs `/products` 186 req/s |

Defects found — full register and severity in the report §5:
**F-01** production image ships 23 local SQLite dev/test databases (password hashes, refresh tokens,
payments; ~21 MB) · **F-02** login burst starves the instance · **F-03** AI quota keyed by IP, not by
user, contradicting `docs/api.md` (30 successes then 1 063 × `429` across 10 000 distinct users) ·
**F-04** all coarse limiters IP-keyed, `limiterStore: memory` in production · **F-05** single-process
CPU ceiling with no backpressure (collapse, not degradation) · **F-06** Prisma pool left at default
9 connections (not the bottleneck — the event loop is) · **F-07** weather cache has no single-flight ·
**F-08** client retries without jitter · **F-09** no server timeout tuning · **F-10** Dockerfile
generates the client from a sed-modified schema, `hashSync` at module load, `/metrics` exposure.

## Deviations from the planned method (all deliberate, all recorded)

1. **The host could not run the intended test.** 206 MB of RAM available and 99 % CPU load made a
   10 000-real-socket generator unsafe and would have made latency meaningless. The generator was
   moved **inside the Docker network** and the socket pool capped (4 200 total); the summed in-flight
   demand peaked at ≈5 700, so the generator's own pool contributed queueing from ≈t+200 s. Requests
   that reported `ETIMEOUT` held a socket and still exceeded 30 s, so 44 516 is a **lower bound** on
   requests exceeding 30 s. Reported as a limit in the report §2.3, not concealed.
2. **Tokens were minted, not obtained by logging in** (one per user, same signer parameters and
   claims as `requireAuth` expects, against real `ACTIVE` rows). Cost-12 bcrypt turns 10 000 real
   logins into ~35 minutes of CPU-bound wall time that would swamp every other measurement; the
   login path is instead measured directly and honestly in its own scenario (F-02).
3. **Rate limits were raised** for capacity passes (`RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX`), the
   technique `docs/testing.md` documents for the e2e suite, so the simulation measures the
   application rather than the throttle. Limiter behaviour at production policy is reported
   separately (F-03, F-04).
4. **The API suite could not run on the host** — the developer's own `node dist/server.js` (PID
   17184, port 4000) holds `query_engine-windows.dll.node`, so `prisma generate` fails with `EPERM`
   and the documented SQLite path cannot start. It was run inside the repository's build-stage image
   instead, touching neither the dev server nor `dev.db`. Three files
   (`docs-route-parity`, `env-parity`, `response-contract`) additionally need root-level files that
   `docker/api.Dockerfile` never copies; they were re-run with `docs/`, `contracts/` and
   `.env.example` bind-mounted, and pass. All 342 counted tests pass with those mounts in place.
5. **297 `ECONNREFUSED` were investigated and attributed to the Docker Desktop Windows port proxy**,
   not the application: the identical burst inside the container network produced 0 errors. Recorded
   as a non-finding (report §6.1).
6. **`apps/web/dist/` and the gitignored `qa-evidence/load10k/` tree** are the only filesystem
   additions; `git diff HEAD` is empty and no tracked file was modified.

## Not run this round

Playwright e2e, Android/APK, Lighthouse, `docker compose` smoke, Trivy/CodeQL/gitleaks, DAST, and any
load test against the real provider paths (OpenWeather / OpenAI-compatible) or the deployed
Vercel + Neon topology.
