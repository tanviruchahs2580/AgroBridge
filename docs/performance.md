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
| Entry bundle (gzip) | **150 kB** | `dist/index.html`'s `assets/index-*.js` |
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
- The repo's Lighthouse config (`apps/web/lighthouserc.json`, `lighthouse.yml`) is
  `workflow_dispatch`-only and has not been the enforcing gate; the byte budgets are.

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
structural: **bcrypt login is CPU-bound at ~11 verifications/s per core**, three orders of
magnitude below the read paths — expected for bcrypt at its configured cost factor, and the
reason login is rate-limited separately (`LOGIN_RATE_LIMIT_MAX`).

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
