<!-- owner: @tanviruchahs2580 · purpose: measured load behaviour and byte budgets (with caveats) · last-verified: 2026-10-21 @ 6550a9a -->

# Performance

What this document is: the measured bounds this repository enforces and one recorded local
measurement. What it is **not**: a capacity claim. Read the closing section before quoting any
number from here to a customer, investor or store listing.

## Web payload budgets (enforced)

`apps/web/scripts/preflight.mjs` defines deterministic byte budgets and fails the run when a
budget is exceeded. It executes in CI in the `web-quality` job after the production build
(`npm run preflight`, ci.yml) and in the web deploy gate — so a regression fails a pull request,
not a user's connection.

| Budget | Limit | Measured against |
|---|---|---|
| Entry bundle (gzip) | **132 kB** | `dist/index.html`'s `assets/index-*.js` |
| All JS (gzip) | **225 kB** | every `dist/assets/*.js` |
| All CSS (gzip) | **15 kB** | every `dist/assets/*.css` |
| Fonts | **520 kB** | `dist/fonts/` raw bytes |
| Images | **2600 kB** | `dist/images/` raw bytes |

Notes:

- The budgets are deliberately loose enough for ordinary refactors and tight enough to catch a
  regression of the kind that shipped before (four byte-identical Bengali font files, two of them
  preloaded — ~343 kB; see ADR-0008). They are not "best-in-class" targets; they are tripwires.
- The same preflight also checks the CSP hash of the inline theme script and that the API origin
  baked into the bundle is allowed by `connect-src` — both are performance/availability traps, not
  cosmetics.
- Lighthouse *does* gate CI: `web-quality` runs `@lhci/cli autorun` against the built bundle,
  and `apps/web/lighthouserc.json` makes the accessibility floor (0.9) an **error** while the
  performance and best-practices budgets warn (there is no `lighthouse.yml` — that workflow was
  removed). The byte budgets above stay the hard failure, because they are deterministic.

## API point-in-time measurement (local, recorded 2026-09 local hardware)

Source: `qa-evidence/P1-loadtest-local.log`, produced by `apps/api/scripts/loadtest.mjs`
(autocannon, 10 s per scenario, against `http://127.0.0.1:4000` — the API on the same developer
machine, SQLite dev database, no TLS, no proxy, single process).

| Scenario | req/s (avg) | p50 | p90 | p99 | non-2xx |
|---|---|---|---|---|---|
| `GET /health` (baseline) | 7659.3 | 1 ms | 1 ms | 4 ms | 0 |
| `GET /api/v1/products` (authenticated read) | 770.9 | 11 ms | 18 ms | 35 ms | 0 |
| `POST /api/v1/auth/login` (bcrypt verify) | 10.8 | 841 ms | 1164 ms | 1532 ms | 0 |
| `GET /api/v1/weather` + risks | 1131.6 | 8 ms | 11 ms | 19 ms | 0 |
| `POST /api/v1/ai/advisory` (grounded, offline engine) | 2918.1 | 3 ms | 4 ms | 8 ms | 32093* |

\* The AI endpoint allows 30 requests/hour per user (`docs/api.md`); the load generator
deliberately exceeds that, so the non-2xx count is the rate limiter working, not failures.
Replayed verbatim from the log; the same file notes it.

**Hardware and methodology caveat:** this was one local run on a developer machine (loopback
network, SQLite file DB, no container overhead, no concurrent traffic), with autocannon on the
same CPU as the server. It says nothing about production: the deployed topology is a Vercel
serverless function in front of Neon PostgreSQL (`docs/runbooks/live-deployment.md`), which adds
network, TLS, cold starts and a real database. The one conclusion that survives the caveat is
structural: **bcrypt login is CPU-bound**, three orders of magnitude below the read paths —
expected for bcrypt at its configured cost factor, and the reason login is rate-limited
separately (`LOGIN_RATE_LIMIT_MAX`).

**Login throughput changed on 2026-10-21 (F-02).** The table above was measured while every
comparison ran on the event loop, where login throughput was capped by the latency of a single
cost-12 hash no matter how many cores the machine had. Hashes now run in the `BCRYPT_POOL_SIZE`
worker threads, so throughput scales with the pool rather than with one core — and, the reason for
the change, a login burst no longer starves every other request in the process. Measured on the
10k-audit sandbox (100 simultaneous logins at cost 12, one production-mode instance):

| | on the event loop | worker pool |
|---|---|---|
| wall time | 77.2 s | **24.6 s** |
| p50 | 46 416 ms | **24 227 ms** |
| throughput | 1.3 logins/s | **4.1 logins/s** |
| server CPU | 106 % (one core) | **395 % (four cores)** |
| event-loop lag p99 | 5 792 ms | **21 ms** |
| unrelated `/health` during the burst | 74 000 ms | **p99 35 ms, max 665 ms** |

A single-instance login ceiling remains: the pool multiplies capacity, it does not remove the cost.
Size the pool, and shape login bursts, before promising capacity — see
`docs/qa/2026-10-21-load-10k-and-condition-report.md` §5.2.

## 10 000 concurrent users — same box, before and after the fixes

The environment description this section exists for (see §No capacity claims below): one
production-mode instance of this repository's own image (`docker/api.Dockerfile`, Node 22
container, `NODE_ENV=production`), one PostgreSQL 17 container, both on one workstation with 4
physical cores — **not** the production topology, which is a serverless function in front of Neon
and additionally carries network, TLS, cold starts and a real database. Both runs use the same
generator, the same 10 000 synthetic farmer identities, one per virtual user, and the same model:
240 s ramp, 240 s hold, human think time of 10–30 s (a closed loop, so offered load is ≈500 req/s
against one instance). Before = `100910` requests measured on commit `0ce54b5` before the fixes;
after = 122 793 on the remediated build (branch `fix/audit-10k-hardening`).

| | before the fixes | after |
|---|---|---|
| requests issued | 100 910 | 122 793 |
| 2xx served (useful) | 55 127 (115/s) | 38 286 (80/s) |
| `503 OVERLOADED` refused | — | 49 585 |
| p50 | 9 721 ms | **3 056 ms** |
| p95 | 56 617 ms | 54 780 ms |
| over 30 s (client timeout) | **44.1 %** | **28.3 %** |
| AI quota rejections (`429`) | 1 063 | **0** |
| 5xx | 0 | 0 |

Read this table the way it was measured, which is narrower than it looks:

- **What the fixes bought, without qualification:** the wrongness is gone. An AI feature that
  rejected 1 063 of exactly 30-per-hour-quota requests now answers every account that asks; a page
  admitting work at an unbounded 5 700 in-flight requests now answers at 1 141 peak and refuses the
  surplus outright; p50 for a served request fell 3×.
- **What no in-process fix can buy:** useful 2xx *fell* from 115/s to 80/s, because the load
  offered (≈500 req/s) exceeds what one instance of this size can serve (~150–250 req/s) and the
  guard now says so instead of queueing it. Before the guard, the surplus got served *slowly*
  (44 % past 30 s); after, it gets refused quickly and retried. Serving 10 000 concurrent users on
  this profile is a capacity problem — more instances, sized against `docs/operations.md`'s
  measured numbers — not a code problem, and the remaining p95 (≈55 s for the backlog) is exactly
  that gap made visible.
- **The database was never the limit here:** 11 connections peak, 1–3 queries active, by
  `pg_stat_activity` sampled through both runs.

## No capacity claims

- No production capacity, concurrency or SLA number is asserted anywhere in this repository.
  There has been no load test against a production-equivalent topology; the profile above is a
  local measurement, not a benchmark.
- Rate limiting currently fails open without `REDIS_URL` (ADR-0010 / docs/security.md), so the
  effective quota is per serverless instance — a deliberate, documented deviation, not headroom.
- Before promising any numeric capacity, run `apps/api/scripts/loadtest.mjs` against a
  production-like environment (PostgreSQL, TLS, the real function runtime) and record the result
  here with the environment description. Until then, treat every number above as a local
  observation with the caveats attached.
