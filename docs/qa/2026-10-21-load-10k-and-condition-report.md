# AgroBridge — current-condition QA and 10k-concurrent-user load report

**Date:** 2026-10-21 · **Commit under test:** `0ce54b59a93657df3c9292db47cd2821f8d8136c` (`main`)
**Author:** full-stack QA pass (ZCode session)
**Verdict:** the application is **functionally sound and correct under extreme load** (no 5xx, no
crashes, no data corruption, all 342 API tests and 161 web tests pass) but it **collapses well
before 10 000 concurrent users on a single instance**, and three defects are release-blocking in
their own right: a production image that ships development databases, an AI quota keyed by IP
instead of by user (contradicting its own documentation), and a login path that a few hundred
simultaneous users can turn into a minute of unavailability.

**Feature lock:** no application source, schema, configuration or test file was modified. `git diff
HEAD` is empty; `git status` shows only pre-existing untracked directories plus gitignored QA
artifacts (see §10).

---

## 1. Executive summary

| # | Finding | Severity | Evidence |
|---|---|---|---|
| F-01 | Production Docker image ships **23 local SQLite development/test databases** (`dev.db`, `test.db`, `e2e.db`, 20 × `audit-*.db`, ~21 MB) containing password hashes, refresh-token hashes, payments, wallet ledgers and audit logs | **High** | §5.1 |
| F-02 | **Login collapses under a modest burst**: 100 simultaneous logins = 77 s wall, p50 **46 s**, ~**1.3 logins/s** per instance, one full CPU core consumed, event-loop lag 5.8 s | **High** | §5.2 |
| F-03 | **AI advisory quota is keyed by IP, not by user**, contradicting `docs/api.md` ("30/hour/**user**"): 10 000 authenticated users got exactly **30 successes and 1 063 `429`s** | **High** | §5.3 |
| F-04 | All five coarse rate limiters (global 300/15 min, login 20/15 min, OTP, register, AI) are **IP-keyed**; carrier-grade NAT users share one quota. `limiterStore: memory` in production without `REDIS_URL` | **Medium-High** | §5.3, §5.4 |
| F-05 | **Single-process CPU ceiling with no admission control**: 10 000 concurrent sessions → 210 req/s served, p50 **9.7 s**, p95 **56.6 s**, **44 516 requests (44 %) exceeded 30 s**; recovers nowhere | **High** | §5.5 |
| F-06 | Prisma pool is left at its default (`cpus × 2 + 1` = **9 connections** here) and is **not** the bottleneck (1–3 ever active) — the event loop is | **Medium** | §5.6 |
| F-07 | Weather cache has **no single-flight/coalescing**; a cold key costs every concurrent caller a provider call (+5.3 CPU-s per 1 000 requests vs warm) | **Medium** | §5.7 |
| F-08 | Web client retries 5xx with **fixed 300 ms / 900 ms delays and no jitter** → synchronised retry waves, up to **3×** amplification of a 5xx burst | **Medium** | §5.8 |
| F-09 | No server-level timeouts configured (`server.timeout`, `keepAliveTimeout`, `headersTimeout`, `maxConnections`) — Node defaults only | **Low-Medium** | §5.9 |
| F-10 | Dockerfile builds the Prisma client from a **sed-modified copy of the SQLite schema**, not from `prisma/postgres/schema.prisma` (equivalent today; a drift hazard) | **Low** | §5.10 |
| F-11 | `bcrypt.hashSync(..., 12)` runs at **module load** (`password.ts`), blocking startup | **Low** | §5.10 |
| F-12 | `/metrics` is unauthenticated in every non-production environment and open to any private-range source in production | **Low** (documented) | §5.10 |

**Strongly positive results** (they matter as much as the defects, and should not be lost in the
finding list): under sustained saturation the API returned **zero 5xx** — every failure was a
client-side timeout or the intended `429`; the error envelope, request-id correlation, Prisma
error mapping and production stack-trace suppression all behaved correctly; IDOR/authorisation,
enumeration-resistance and idempotency suites pass on PostgreSQL 17.

---

## 2. Scope and method

### 2.1 What was verified

| Gate | Command | Result |
|---|---|---|
| API + web typecheck | `npm run typecheck` | **pass** (no output) |
| API suite, PostgreSQL 17, production migration chain | `node scripts/provision-postgres.mjs && npx vitest run --config vitest.config.pg.ts` | **342 passed / 342** (57 files) |
| Web unit tests | `npm run test --workspace apps/web` | **161 passed / 161** (16 files) |
| Web lint | `npm run lint --workspace apps/web` | **pass** |
| i18n check | `npm run i18n:check --workspace apps/web` | **419 referenced / 633 declared / 0 missing** |
| Web production build | `npm run build --workspace apps/web` | **pass** (entry 463.59 kB → 146.16 kB gzip) |
| Web byte-budget preflight | `npm run preflight --workspace apps/web` | **pass** — entry 142.4/150 kB, JS 208.8/225 kB, CSS 11.7/15 kB, fonts 486.3/520 kB, images 2428/2600 kB; CSP hash and `connect-src` checks pass |

**Not run this round** (and therefore not claimed): Playwright e2e, Android/APK build, Lighthouse,
`docker compose` smoke, Trivy/CodeQL/gitleaks scans, DAST. The API suite was executed inside the
repository's own build-stage image (`docker/api.Dockerfile --target build`) so that the developer's
running dev server was never disturbed.

### 2.2 How the load simulation was built

A synthetic but faithful environment, isolated from every pre-existing resource:

- **Target:** the repository's own production image (`docker build -f docker/api.Dockerfile`),
  `NODE_ENV=production`, one Node process, no CPU limit, `agro-qa-api` on host port 4100.
- **Database:** dedicated `postgres:17-alpine` container (`agro-qa-pg`, port 55432) provisioned with
  **the production migration chain** (`prisma/postgres/` via `scripts/deploy-migrations.mjs`'s
  schema), then seeded with the demo catalogue plus **10 000 synthetic farmers** (one farm, plot,
  crop cycle, wallet, cart and farmer profile each; bcrypt cost 12).
- **Identity:** one access token minted per user with the API's own signer parameters
  (`sub`/`role`, HS256, `iss: agrobridge`) and the QA container's secret. Login was deliberately
  isolated into its own scenario because cost-12 bcrypt makes 10 000 real logins a ~35-minute
  CPU-bound exercise that would swamp every other measurement — §5.2 exercises the real login path
  honestly and on its own.
- **Generator:** a purpose-built closed-loop virtual-user engine (`vu-engine.mjs` +
  `run-load.mjs`), 6 worker processes, a weighted journey mix (products 30 %, weather 18 %,
  farms 12 %, notifications 10 %, wallet 11 %, orders 7 %, cart 6 %, farm-event write 3 %,
  cart write 3 %, AI advisory 2 %), human think time, ramp then hold, per-interval deltas, and
  server-side sampling from the app's own Prometheus endpoint.

### 2.3 Fidelity limits — read before quoting any number

1. **The sandbox is ~5× slower than the repository's reference machine.** `GET /health` at
   concurrency 50 measured **1 433 req/s** here against **7 659 req/s** recorded in
   `docs/performance.md`; `GET /products` measured **186 req/s** against ~400–770. The host had
   **206 MB of 7.5 GB RAM free** (Windows memory compression at 2.75 GB) and 4 physical / 8 logical
   cores shared with the developer's own dev servers and Docker VM. **Absolute throughput and
   absolute latency are sandbox-bound. Relative comparisons, ratios and failure modes are the
   durable output**, and even those should be re-measured on production-like hardware before any
   capacity promise — consistent with this repository's existing "No capacity claims" policy.
2. **10 000 concurrent *sessions*, not 10 000 simultaneous TCP sockets.** Each virtual user is an
   independent session with its own identity and journey; the client pool was capped at 700 sockets
   per worker (4 200 total). Per-worker peak in-flight (1 095) never reached that cap, but the
   summed in-flight across workers did peak at **≈5 700**, so from roughly t+200 s the generator's
   own socket pool was also queueing. Requests that reported `ETIMEOUT` had a socket and still
   exceeded 30 s, so **44 516 requests genuinely took more than 30 seconds end-to-end** — the
   timeout count is a lower bound, not an artefact of the pool.
3. **The Docker Desktop Windows port proxy is in the path** for any host-side measurement. It is
   not the app: an identical 1 000-request burst produced **297 `ECONNREFUSED` through the proxy and
   exactly 0** when repeated inside the container network (§6.1). All reported load numbers were
   taken inside the container network.
4. **Rate limits were raised for capacity passes** (`RATE_LIMIT_MAX`/`LOGIN_RATE_LIMIT_MAX`), which
   is the technique `docs/testing.md` already documents for the e2e suite. This measures the
   application, not the throttle. Production-policy behaviour is reported separately in §5.3.

---

## 3. Calibration

| Measurement | This sandbox | Repository's recorded reference | Ratio |
|---|---|---|---|
| `GET /health` @ c=50 | 1 433 req/s, p50 28 ms, p99 129 ms | 7 659 req/s, p50 1 ms | ~5.3× slower |
| `GET /api/v1/products` @ c=50 (auth + DB) | 186 req/s, p50 226 ms, p99 806 ms | ~400 req/s, p50 23 ms (PG profile) | ~2× slower throughput, ~10× worse p50 |
| Idle single request (`/products`, sequential) | 12–25 ms typical | — | — |

The last row matters: **when the server is idle it is fast.** Every dramatic number below is a
queueing/saturation phenomenon, not per-request cost.

---

## 4. The 10 000-concurrent-user simulation

**Model:** 10 000 virtual users over 6 worker processes, 240 s ramp (staggered starts), 240 s hold,
think time 10–30 s (mean 20 s) ⇒ **offered load ≈ 500 req/s** against a single API instance.

### 4.1 Headline result

```
users = 10 000        ramp 240 s / hold 240 s        offered ≈ 500 req/s
requests issued ........ 100 910
throughput served ...... 210 req/s
p50 ....................  9 721 ms
p90 .................... 53 234 ms
p95 .................... 56 617 ms
p99 .................... 59 323 ms
ETIMEOUT (>30 s) .......  44 516   (44.1 % of all requests)
ECONNRESET .............     204
2xx ....................  55 127   (200: 51 775 · 201: 3 352)
429 ....................   1 063   (all from the AI limiter — see F-03)
5xx ....................       0
```

Per route, every journey step shows the same signature — p50 ≈ 9–12 s, p95 ≈ 56 s:

| Route | count | rps | p50 | p95 | non-2xx |
|---|---|---|---|---|---|
| `GET /products` | 30 197 | 62.9 | 9 595 ms | 56 606 ms | 13 291 timeout |
| `GET /weather` | 18 402 | 38.3 | 9 158 ms | 56 579 ms | 8 023 timeout |
| `GET /farms` | 11 963 | 24.9 | 12 001 ms | 56 632 ms | 5 303 timeout |
| `GET /notifications` | 10 121 | 21.1 | 9 574 ms | 56 601 ms | 4 443 timeout |
| `GET /wallet/summary` | 8 073 | 16.8 | 9 772 ms | 56 676 ms | 3 627 timeout |
| `GET /orders` | 7 055 | 14.7 | 9 786 ms | 56 628 ms | 3 125 timeout |
| `GET /cart` | 6 075 | 12.7 | 9 729 ms | 56 663 ms | 2 712 timeout |
| `POST /farms/:id/events` | 3 028 | 6.3 | 9 937 ms | 56 575 ms | 1 317 timeout |
| `POST /cart/items` | 3 020 | 6.3 | 17 170 ms | 56 689 ms | 1 360 timeout |
| `POST /ai/advisory` | 1 976 | 4.1 | 9 415 ms | 56 655 ms | 30 × 200, **1 063 × 429**, 879 timeout |
| `GET /ai/history` | 1 000 | 2.1 | 9 528 ms | 56 614 ms | 436 timeout |

### 4.2 The knee (2-second buckets, selected)

| t+s | req/2s | p50 | p95 | in-flight | timeouts |
|---|---|---|---|---|---|
| 10 | 84 | **11 ms** | 40 ms | 1 | 0 |
| 34 | 188 | 47 ms | 299 ms | 1 | 0 |
| 58 | 200 | 342 ms | 942 ms | 99 | 0 |
| 70 | 235 | **1 541 ms** | 3 694 ms | 334 | 0 |
| 94 | 220 | 7 143 ms | 9 863 ms | 1 887 | 0 |
| 118 | 567 | 711 ms | **55 452 ms** | 1 457 | 187 |
| 166 | 223 | 36 771 ms | 57 677 ms | 4 130 | 144 |
| 250 | 729 | 30 995 ms | 57 100 ms | 5 000 | 377 |
| 478 | 238 | 7 874 ms | 52 563 ms | 5 260 | 48 |

The system is healthy to roughly **100–190 req/s** (p50 under ~350 ms). It passes the knee around
t+70 s and **never returns to a healthy state for the remainder of the run** — a classic congestion
collapse with no backpressure, no admission control and no load shedding.

### 4.3 Server-side view during the run

| Metric | Idle | Under load |
|---|---|---|
| Process CPU | 0.6 – 0.8 % | **200 – 310 %** (2–3 cores) |
| Event-loop lag p99 | 12 – 18 ms | **400 – 940 ms** |
| RSS | 72 MB | 197 MB |
| Active handles | 47 | 357 |
| Postgres backends | 10 | **11 (max)** |
| Postgres queries active | 1 | **1 – 3** |
| 5xx | 0 | **0** |

**The database is not the bottleneck.** Prisma never opened more than ~9 pool connections
(`num_physical_cpus × 2 + 1` = 9 on a 4-core view) and only 1–3 were ever executing. The ceiling is
**event-loop CPU in a single Node process** (§5.6).

---

## 5. Findings

### F-01 — Production image ships 23 development databases · **High**

`docker run --entrypoint sh agrobridge-api:qa10k -c "find /app -name '*.db' | wc -l"` → **23**,
including `dev.db`, `test.db`, `e2e.db` and twenty `audit-*.db`, ~21 MB total, inside the *runtime*
stage of the shipped image.

Row counts read directly from the shipped files:

| File | Notable contents |
|---|---|
| `dev.db` | 8 users, **64 refresh tokens**, 9 orders, 9 payments, 8 wallets, 107 audit logs |
| `test.db` | 6 users, 30 refresh tokens, 3 orders, 43 audit logs |
| `e2e.db` | 11 users, 28 refresh tokens, 5 advisory queries, 43 audit logs |
| `audit-w1full.db` | **154 users, 191 refresh tokens**, 26 payments, 7 procurement orders, 15 withdrawals, 3 OTP challenges, 286 audit logs |

**Root cause:** `.dockerignore` excludes `node_modules`, `.git`, `docs`, `*.md`, `*.log`, `.env` and
`coverage` — but **not `*.db`/`*.sqlite`**. `docker/api.Dockerfile` copies `apps/api/` wholesale in
the build stage and then `COPY --from=build /app/apps/api/prisma ./apps/api/prisma` into the runtime
stage, carrying every local database with it.

**Impact:** a production artefact distributed to any registry, reviewer or operator contains
credential material (bcrypt password hashes, refresh-token hashes), payment and wallet rows, and
audit trails from local development and QA runs. It is also ~21 MB of pure image bloat, and any
future local test that touches realistic data silently ships that data. No evidence was found that
these specific rows are real customer data, but the mechanism is unacceptable regardless.

**Fix:** add `*.db`, `*.sqlite`, `*.db-journal` to `.dockerignore`; copy only
`prisma/migrations`, `prisma/postgres` and `prisma/schema*.prisma` into the runtime image instead of
the whole directory; add a CI assertion that the runtime image contains no `*.db`.

---

### F-02 — A few hundred simultaneous logins take the instance down · **High**

Two independent runs, the second inside the container network:

| Scenario | Wall | Result | Throughput | Server CPU | Event-loop p99 |
|---|---|---|---|---|---|
| 200 simultaneous logins (60 s client timeout) | 60.4 s | **98 ok, 102 timed out** | 3.3 /s | +113 CPU-s (187 %) | **9 186 ms** |
| 100 simultaneous logins (90 s client timeout) | 77.2 s | 100 ok, **p50 46.4 s**, p95 76.3 s | **1.3 /s** | +81.9 CPU-s (**106 % of one core**) | 5 792 ms |

An unrelated `GET /health` probe issued *during* the burst waited **60 s** (first run) and **74 s**
(second run) — the login work starves every other request in the process.

**Root cause:** `bcryptjs@2.4.3` is a pure-JavaScript implementation, and the login path runs at the
**production cost factor 12** (`isTest ? 4 : 12`). The library *does* yield between rounds via
`setImmediate` (verified in `dist/bcrypt.js:351`), so this is CPU starvation of a shared event loop
rather than a hard block — the measured 106 % of a single core proves the work is confined to one
thread and cannot use the other cores. Cost: **~0.5–0.8 CPU-seconds per login** on this hardware.
Two design decisions also multiply the cost: `verifyPasswordAgainst` performs exactly one bcrypt
comparison *even for unknown phone numbers* (a deliberate and correct anti-enumeration measure,
`password.ts`), and `DUMMY_PASSWORD_HASH = bcrypt.hashSync(..., 12)` is computed **at module load**.

**Impact:** ~**1.3–1.9 logins/second per instance**. For 10 000 users opening the app inside a
five-minute morning window (33 logins/s) this needs on the order of **20+ instances** of *login*
capacity — far more than the read path needs. Worse, a burst degrades the *whole* instance, so a
login spike is indistinguishable from an outage for users who are already signed in.

**Fix (in order of effect):** (a) move bcrypt off the request path — replace `bcryptjs` with a
native binding (`@node-rs/bcrypt` / `bcrypt`) or run hashing in a worker pool; (b) front login with
a queue/rate shaper so a burst queues predictably instead of starving the loop; (c) consider cost 10
with a rehash-on-login upgrade path; (d) keep the constant-time dummy comparison but precompute it
off the startup path.

---

### F-03 — The AI quota is keyed by IP, not by user, and contradicts its documentation · **High**

`docs/api.md:65` states the advisory endpoint is *"Rate limited to 30/hour/**user**"*.
`apps/api/src/modules/aiagent/routes.ts` builds `aiLimiter` **without a `keyGenerator`**, so
express-rate-limit falls back to `req.ip`.

Measured, with 10 000 distinct authenticated users all reaching the API from one address:

| Run | Users | `200` | `429` |
|---|---|---|---|
| Baseline pass | 200 distinct identities | **30** | **184** |
| 10 000-user pass | 10 000 distinct identities | **30** | **1 063** |

Exactly 30 requests succeeded across the entire population, then every further AI request was
rejected — while each request carried a *different, valid* user's token.

**Impact:** in production this quota is per *public IP*. On Bangladeshi mobile networks
(carrier-grade NAT) thousands of farmers share one public address: the first 30 AI questions per
hour consume the hourly quota for every user behind that address, and the rest see
`AI advisory limit reached`. The feature silently stops working for the users it was built for.
This is a correctness bug, not a tuning issue.

**Fix:** key on the authenticated principal — `keyGenerator: byUserOrIp` exactly as
`checkoutLimiter`, `financialLimiter`, `exportLimiter` and `otpVerifyLimiter` already do in this
same codebase (§5.4). Then reconcile `docs/api.md` either way.

---

### F-04 — Coarse limiters are all IP-keyed; with no Redis the window is per instance · **Medium-High**

Audit of every `rateLimit()` in the API:

| Limiter | Scope | Key | Consequence |
|---|---|---|---|
| `globalLimiter` | all `/api/` | **IP** (no `keyGenerator`) | 300 req/15 min shared by everyone behind one NAT address |
| `aiLimiter` | `/ai/advisory` | **IP** | F-03 |
| `loginLimiter` | `/auth/login`, `/auth/refresh` | **IP** | 20 attempts/15 min **per address**, not per account |
| `otpLimiter` | `/auth/otp/request` | **IP** | 5/h per address |
| `registerLimiter` | `/auth/register` | **IP** | 10/h per address |
| `otpVerifyLimiter` | `/auth/otp/verify` | user | correct |
| `exportLimiter` | `/auth/me/export` | user | correct |
| `checkoutLimiter` | `/orders/checkout` | user-or-IP | correct |
| `financialLimiter` | `/wallet/withdrawals` | user-or-IP | correct |

Two further properties compound it:

- `/ready` reports **`limiterStore: memory`** in this production-mode deployment because `REDIS_URL`
  is unset. Every instance therefore enforces its own window, so the effective quota is
  `instances × limit` — the documented, accepted fail-open (ADR-0010), but it means the limits are
  simultaneously **too strict for NAT users and too loose as an abuse control**.
- All five coarse limiters carry `skip: () => NODE_ENV === "development"`, so no local or
  dev-environment testing can ever surface this class of bug — which is why it survived to this
  report. The e2e suite raises the limits rather than asserting them.

**Fix:** key the user-facing limiters on the authenticated principal (or a stable device/session
identity) where auth is available, and on `ip + route` where it is not; set `REDIS_URL` in
production so windows are shared; keep the fail-open but make it a loud startup error in production
rather than a warning.

---

### F-05 — Single-process CPU ceiling, no admission control, collapse rather than degrade · **High**

See §4. One instance served 210 req/s while 10 000 sessions offered ~500 req/s; latency rose without
bound until 44 % of requests exceeded 30 s, and it stayed there. No 5xx was ever returned and the
process never crashed — the app is *honest* under overload, but it has no mechanism to protect
itself or to fail fast for some users so others can succeed.

**Structural causes:** a single Node process handles every request; `requireAuth` performs a
database lookup for **every** authenticated request with no cache (measured cost below); the JS
event loop is the serialisation point; there is no queue depth limit, no per-route concurrency cap
and no `503 + Retry-After` shedding.

**Measured per-request CPU cost** (250 requests per route, concurrency 8, read from the server's own
`process_cpu_seconds_total`; treat as indicative — short windows over-credit cheap routes, so the
*ratio* is the signal):

| Route | CPU/req | vs baseline |
|---|---|---|
| `GET /health` (helmet + cors + metrics + JSON only) | 3.9 ms | — |
| `GET /ready` (+2 raw DB queries) | 3.7 ms | ~1× |
| `GET /api/v1/weather` (auth + cache hit, no handler DB work) | 6.0 ms | ~1.5× |
| `GET /api/v1/auth/me` (auth + 1 DB) | 13.5 ms | ~3.5× |
| `GET /api/v1/farms` (auth + DB) | 15.1 ms | ~3.9× |
| `GET /api/v1/products` (auth + 2 DB) | 17.7 ms | ~4.5× |
| `GET /api/v1/wallet/summary` (auth + 4 DB) | 18.4 ms | ~4.7× |

The autocannon pair is the cleaner statement of the same fact: **`/health` 1 433 req/s vs
`/products` 186 req/s — a 7.7× cost for adding authentication plus the ORM**, on identical
hardware, in the same minute.

**Fix:** remove the per-request user lookup from the hot path (short-TTL cache of
`{status, role}` keyed by user id, invalidated on suspend/delete/role-change, or a token-carried
claim plus a revocation set); scale horizontally behind a load balancer *and* raise the Prisma pool
per instance to match (§F-06); add explicit backpressure — bounded queue, `503` with `Retry-After`
beyond it, and per-route concurrency caps — so overload degrades instead of collapsing.

---

### F-06 — Prisma pool left at its default, and it is not the bottleneck · **Medium**

`apps/api/src/infrastructure/database/prisma.ts` constructs `new PrismaClient({ log })` with **no
pool configuration and no `DATABASE_URL` parameters**. Prisma's default is
`num_physical_cpus × 2 + 1`, which in the 4-core container view is **9 connections** — matching the
observed 10–11 backends in `pg_stat_activity` (9 pool + sampler). Across the whole 10 000-user run
never more than **3 queries were active at once**, and Postgres CPU stayed at 43–84 %.

So the pool is a real structural limit (with 10 000 concurrent users at most 9 queries can ever be
in flight, with the rest waiting in Prisma's client-side queue, whose default `pool_timeout` of 10 s
would surface as `P2024`) — but it was **not** the active constraint here; the event loop was.
`errorHandler` also has no `P2024` mapping, so a genuine pool timeout would surface as a raw
`500 INTERNAL_ERROR` rather than an honest `503`.

**Fix:** set the pool explicitly (`connection_limit`, `pool_timeout`) per instance size, map `P2024`
to a `503` with `Retry-After`, and size the pool against the database's own `max_connections` for
the whole fleet.

---

### F-07 — Weather cache has no single-flight; cold keys stampede the provider · **Medium**

`apps/api/src/modules/weather/cache.ts` is a plain in-memory `Map` with a TTL and no in-flight map,
so N concurrent requests for an un-cached location all miss and all call the provider.

Measured with 1 000 simultaneous requests for the same coordinates:

| Key state | Wall | p50 | Server CPU | Event-loop p99 |
|---|---|---|---|---|
| **Cold** (never requested) | 7.06 s | 5 270 ms | **+12.66 CPU-s** | 717 ms |
| **Warm** (same key, immediately after) | 5.08 s | 4 023 ms | **+7.35 CPU-s** | 290 ms |

The **+5.31 CPU-seconds per 1 000 requests** is the provider work every cold caller independently
performed (1 000 × ~5.3 ms), which is the coalescing that does not happen. The weather file's own
design notes correctly insist that a *failure* must never be served from cache; the same rigour is
missing for concurrent *misses*.

**Impact:** with `WEATHER_PROVIDER=openweather` (the documented production setting) a cold key turns
into N outbound HTTPS calls against an 8 s timeout each — provider rate limits, provider-side cost
and `429`s, plus a stalled request for every user. The cache is also per-process, so N instances
multiply provider traffic by N and every instance starts cold after a deploy — exactly the 6 a.m.
peak this feature exists for.

**Fix:** add a single-flight/promise-map so the first caller fetches and the rest await the same
promise; consider a shared (Redis) cache so instances don't each pay a cold start.

---

### F-08 — Web client retries without jitter, amplifying 5xx up to 3× · **Medium**

`apps/web/src/lib/api.ts`: `GET_RETRY_DELAYS_MS = [300, 900]`, applied to network errors, timeouts
and any response `>= 500`, with no randomisation. During an overload event every client that failed
at the same moment retries at the same moment — three synchronised waves where there was one.

The client is otherwise well built for this: 45 s timeout, single-flight token refresh, one
correlation id per logical request, retries never apply to 4xx, and offline writes are queued
rather than retried aggressively. The missing piece is jitter.

**Fix:** add jitter (`300 × (0.5 + random())`), and treat `503/429` with the server's `Retry-After`
instead of the fixed schedule.

---

### F-09 — No server-level timeout or connection tuning · **Low-Medium**

`apps/api/src/server.ts` calls `app.listen(env.PORT, …)` and configures graceful shutdown, but never
sets `server.requestTimeout`, `server.headersTimeout`, `server.keepAliveTimeout` or
`server.maxConnections`. Node's defaults (300 s request timeout, 60 s headers, 5 s keep-alive) apply.
On a single-threaded process that queues unboundedly, a long request timeout is precisely the wrong
default: it let requests accumulate for minutes instead of failing fast, and it is what made the
30-second client timeouts in §4 possible at all.

**Fix:** set explicit, short `requestTimeout`/`headersTimeout`, and pair them with the backpressure
work in F-05 so a slow request is rejected rather than queued.

---

### F-10 — Smaller observations · **Low**

- **Schema-source drift hazard.** `docker/api.Dockerfile` builds its Prisma client with
  `sed 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma`, not from
  `prisma/postgres/schema.prisma`. A diff against the production schema shows they are equivalent
  *today* (only `binaryTargets` differ, plus one index's position in the model body) — so this is not
  a defect now, but the shipped client is generated from a different file than the migration chain
  applies, and nothing in CI would catch the two drifting apart. Verified and recorded; recommend
  removing the `sed` and generating from the real schema.
- **Startup cost.** `DUMMY_PASSWORD_HASH = bcrypt.hashSync(DUMMY_PASSWORD_SOURCE, isTest ? 4 : 12)`
  runs at module load, so every cold start of every serverless instance pays a synchronously-blocking
  cost-12 hash before serving.
- **`/metrics` exposure.** Open unconditionally in non-production, and in production to any source in
  a private range or holding `METRICS_TOKEN`. Verified working: `403` without a token in production.
  Acceptable as designed; worth an explicit note in the deployment checklist since it exposes route
  inventory and traffic shape.

---

## 6. Verified non-findings (ruled out, so they are not re-investigated later)

**6.1 — 297 `ECONNREFUSED` are the Docker Desktop port proxy, not the app.** A 1 000-request
synchronised burst through the host port mapping failed 297 connections at the TCP layer; the
identical burst from inside the container network completed **1 000/1 000 with zero errors**. The
application never refused a connection. (Deployment-relevant footnote: whoever sits in front of the
API — a port proxy, a load balancer, an edge function — owns the accept backlog, and its limits
become user-visible before the app's do.)

**6.2 — No 5xx, no crash, no corruption under sustained overload.** Across 100 910 requests at 10 000
concurrent sessions, including 44 516 client timeouts, the API returned **zero** `500`/`502`/`503`
and remained logically correct; every non-2xx was either the intended AI `429` or a client-side
timeout. Graceful-shutdown handlers, the error envelope and Prisma error mapping all behaved.

**6.3 — The database was never the constraint.** 11 backends maximum, 1–3 active queries,
43–84 % Postgres CPU. Any conclusion that "the database needs scaling" would be wrong.

**6.4 — The repository's own functional state is green.** 342/342 API tests on PostgreSQL 17 against
the production migration chain, 161/161 web unit tests, typecheck, lint, i18n, production build and
all six byte-budget preflights pass at the commit under test.

---

## 7. What this report does *not* establish

- **No production capacity claim.** Every number is from a 4-physical-core, memory-starved sandbox
  ~5× slower than the repository's reference machine. The *ratios* and *failure modes* transfer; the
  absolute figures must be re-measured on the production topology (Vercel function + Neon) before
  anyone quotes them — the same rule `docs/performance.md` already sets for itself.
- The real provider path (`WEATHER_PROVIDER=openweather`, `AI_PROVIDER=openai-compatible`) was **not**
  exercised; mock/offline providers were used, so external latency, provider quotas and their
  failure taxonomy are unmeasured here.
- Serverless behaviour (cold starts, per-instance rate-limit multiplication, Neon connection
  pooling/proxy behaviour) is **not** represented by a long-lived container.
- No mobile/WebView, payment-gateway (SSLCommerz), SMS, S3/storage or admin-console-under-load
  testing was performed.
- Multi-tenant/RBAC-heavy admin paths were not load-tested; the mix models a farmer's app session.

---

## 8. Recommended order of work

1. **F-01** — stop shipping development databases (one `.dockerignore` line plus a CI assertion). Cheap, immediate, removes a live data-exposure path.
2. **F-03** — one-line `keyGenerator` on `aiLimiter`, matching four sibling limiters already in the codebase, and fix the doc. The AI feature is currently broken for its target users.
3. **F-02** — move bcrypt off the request path. This is the single largest availability risk and it is a well-understood change.
4. **F-05 + F-06** — remove the per-request auth lookup from the hot path, size the pool explicitly, add backpressure (`503 + Retry-After`, bounded queues). Together these determine whether the platform degrades or collapses under a real launch-day spike.
5. **F-07, F-08, F-09, F-04** — single-flight the weather cache, add jitter to client retries, set server timeouts, key the remaining limiters on the principal and share their windows via Redis.
6. Re-run §4 against production-like hardware and publish the result where `docs/performance.md` says such a number belongs.

---

## 9. Reproduction

All QA commands are hermetic and touch only disposable containers. From
`qa-evidence/load10k/` (gitignored working material):

```bash
source qa-env.sh                        # QA secrets + endpoints; containers only
# 1. environment (isolated PG17 on :55432, API in production mode on :4100)
docker run -d --name agro-qa-pg -e POSTGRES_DB=agrobridge -e POSTGRES_USER=agrobridge \
  -e POSTGRES_PASSWORD=qa10k-password -p 55432:5432 postgres:17-alpine -c max_connections=200
docker network connect agro-qa-net agro-qa-pg
node qa-evidence/load10k/seed-loadtest-data.mjs --count=10000 | docker exec -i agro-qa-pg psql -U agrobridge -d agrobridge
node build-fixture.mjs --users=10000 --workers=6 --out=fixture.json
# 2. baseline / 10k / storms (run inside the container network — see §6.1)
node prepare-pass.mjs --label=10k --users=10000 --workers=6 --ramp=240 --duration=240 \
  --think-min=10000 --think-max=30000 --sockets=700
node run-load.mjs --config=pass-10k.json --label=10k
node storm.mjs --mode=login   --concurrency=100
node storm.mjs --mode=weather --cold --concurrency=1000
node cpu-profile.mjs --n=250 --concurrency=8
node analyze.mjs results/<file>.json --timeline
```

---

## 10. Artifacts

Gitignored working material under `qa-evidence/load10k/` (never committed, per the repository's own
rule that `qa-evidence/*` is working material):

| Artifact | Contents |
|---|---|
| `results/10k-2026-10-20T19-48-05-454Z.json` | full 10 000-user run: 2.2 MB of per-route and per-2-second data, plus 300 server-side metric samples |
| `results/baseline-*.json` | baseline passes |
| `qa-10k-samples.csv` | 60 samples of `pg_stat_activity` pool state + container CPU/memory during the run |
| `vu-engine.mjs`, `run-load.mjs`, `storm.mjs`, `cpu-profile.mjs`, `analyze.mjs`, `prepare-pass.mjs`, `seed-loadtest-data.mjs`, `build-fixture.mjs`, `sampler.sh`, `qa-env.sh` | the harness |
| `qa-evidence/receipts/2026-10-21-load-10k-concurrency.md` | committed receipt: commands, machine, headline result, deviations |

**Repository state:** `git diff HEAD` is empty — no tracked file changed. The only untracked paths
are the pre-existing `apps/web/.lighthouseci/` and `jscpd-report/`, this round's gitignored
`qa-evidence/load10k/`, the new receipt, and `apps/web/dist/` produced by the standard
`npm run build --workspace apps/web` gate (gitignored build output).

---

## 11. Remediation status (2026-10-21, branch `fix/audit-10k-hardening`)

All twelve findings in §5 are addressed. What each fix was verified by is in `CHANGELOG.md`
under the 2026-10-21 entry; the headline before/after, re-measured on the rebuilt production
image:

| Finding | Before | After |
|---|---|---|
| F-01 image databases | 23 files · 20.3 MB | **0** (asserted in CI) |
| F-02 100 simultaneous logins | 77.2 s · p50 46 416 ms · 1.3/s · one core · probe waited **74 000 ms** | **23.8 s · p50 23 293 ms · 4.2/s · four cores · probe p95 13 ms** |
| F-03 AI quota, 2 accounts on one address | second account throttled | **`RateLimit-Remaining: 29` for both** |
| F-05 1 000-user unbounded burst | p50 954 ms · 13.1 % over 30 s | **p50 385 ms · 6.1 % over 30 s** (ceiling sized to the instance) |
| F-07 cold weather key | 12.66 CPU-s per 1 000 requests | 7.35 CPU-s (one shared load) |

### One recommendation deliberately not implemented

§5's F-05 fix list included caching the per-request `requireAuth` user lookup. That was **not**
done, for a reason worth recording rather than rediscovering: the lookup is what makes suspension
and deletion take effect immediately, `journey-admin.test.ts` asserts that property, and a cache —
which is necessarily per process — would widen the guarantee to "within the TTL, per instance"
across the fleet. The measured prize is small: the lookup is roughly 2 ms of a 13–18 ms
authenticated request (~12 %). A security guarantee that the repository tests and documents is
worth more than 12 % of one instance's throughput; the structural answer to F-05 is the
backpressure guard (added) plus horizontal scaling (documented in `docs/operations.md`). If the
trade is ever taken deliberately, it needs a Redis-backed revocation set, not a bare TTL cache.

### Second pass (same day, all findings closed)

- **F-05 remainder resolved without the cache.** Instead of the rejected TTL cache, the per-request
  lookup was made cheaper: `requireAuth` now reads a minimal raw projection (3 000-call benchmark:
  mean 3.03 ms → **1.23 ms**, CPU 1.84 → **0.73 ms**, same table/instant/answer). Revocation stays
  immediate, and `auth-hot-path.test.ts` pins the semantics that had to survive the change: the
  role comes from the database and never from the token, an unknown subject is rejected through the
  no-row path, and suspension still cuts an account off on the next request.
- **F-02 (c) implemented:** a stored hash whose own embedded cost is lower than the configured
  factor is re-hashed at the current cost on successful login (best-effort; a failed upgrade never
  fails a login). Dormant today — every hash is written at the configured factor — it exists so the
  cost factor can be lowered deliberately under load without the weakening becoming permanent.
- **F-09 completed:** `SERVER_MAX_CONNECTIONS` caps connections at the process edge, for the
  backlog the 10k run measured as unreachable by any middleware.
- **§8.6 verification done:** the identical 10 000-user simulation re-run on the remediated build —
  requests **100 910 → 122 793**, p50 **9 721 → 3 056 ms**, over-30-s **44.1 % → 28.3 %**,
  AI `429` **1 063 → 0**, `5xx` **0 → 0**; the guard now sheds 49 585 instead of queueing the
  surplus. The honest cost is recorded in `docs/performance.md`'s table: useful 2xx fell from
  115/s to 80/s, because at 10 000 sessions the offered load (≈500 req/s) exceeds one instance's
  ~150–250 req/s — capacity, not code, is the remaining answer, and the ≈55 s p95 backlog is that
  gap made visible. The overhead-guard comparison tables in `docs/operations.md` were re-measured
  in a single session (guard off / 256 / 128 / 24) with a useful-2xx column, so the guard's
  trade-off is decision-grade rather than folklore.
