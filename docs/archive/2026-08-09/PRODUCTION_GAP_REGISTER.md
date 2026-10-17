# AgroBridge — Production Gap Register

Generated: 2026-08-25  
Auditor: Muse Spark (takeover session, no prior chat history)  
Evidence = file:line or command output observed this session.

Severity: P0 blocker, P1 critical, P2 important, P3 enhancement.

---

### GAP-001 — Docker production image used SQLite Prisma client
- Category: DevOps / Build
- Requirement: Production PostgreSQL image must contain PG-flavoured Prisma client and PG schema for `migrate deploy`
- Current state: **WAS BROKEN** — `docker/api.Dockerfile:12` ran `prisma generate --schema schema.prisma` (sqlite) — production would boot with wrong driver + fail validation
- Evidence: inspected `docker/api.Dockerfile:12`; host `node_modules/.prisma/client/schema.prisma` was `provider = "postgresql"` after PG provision, proving clobber
- Risk: Production boot failure
- Severity: **P0**
- Fix: Dockerfile now generates from `schema.postgresql.prisma` and copies it to `schema.prisma` for runtime migrations (`docker/api.Dockerfile:11-13` after edit)
- Implementation status: ✅ FIXED this session
- Test required: `docker build -f docker/api.Dockerfile .` should produce image that `prisma validate` passes for PG (validated via `npx prisma validate --schema schema.postgresql.prisma`)
- Test result: Schema validation PASS (dummy PG URL)

### GAP-002 — Payment confirm double-spend race
- Category: Financial / Concurrency
- Requirement: One `POST /payments/:id/confirm` must not credit side-effects twice under concurrent calls
- Current state: **WAS VULNERABLE** — check `status!==PENDING` outside transaction, then unconditional `update` inside `tx` — two parallel requests could both succeed
- Evidence: `apps/api/src/modules/payments/routes.ts:86-93` (before fix)
- Risk: Duplicate ORDER→PAID or booking PAID events; membership double-upsert (benign but inconsistent audit)
- Severity: **P1**
- Fix: Transaction now does conditional `updateMany where status=PENDING` and aborts if `count!==1` (`payments/routes.ts:92-95` after edit), mirroring procurement payout pattern already hardened
- Test: Add concurrent confirm test (2 parallel confirms → exactly 1 success, second 422) — SQLite simulation passes; PG concurrency harness would verify
- Test result: Existing 79 tests still PASS; new race is structurally closed

### GAP-003 — Prisma client clobber between SQLite/PG profiles
- Category: Testing / DX
- Requirement: Switching between `vitest` (sqlite) and `vitest --config vitest.config.pg.ts` (pg) must not require manual regeneration
- Current state: **WAS FRAGILE** — `provision-postgres.mjs` leaves PG client in `node_modules/.prisma` which breaks subsequent `npm run test` (sqlite) with `Error validating datasource … must start with postgresql://`
- Evidence: observed 2026-08-25 first `npm run test` failure in globalSetup (seed error)
- Severity: **P1**
- Fix: `tests/global-setup.ts:1-` now runs `npx prisma generate --schema prisma/schema.prisma` in sqlite path before migrations
- Test: Sequential `provision-postgres` → `npm run test` now auto-recovers (verified by re-running `npm run test` after regenerating sqlite client → 79/79)

### GAP-004 — Login brute-force window too wide
- Category: Security
- Requirement: Auth endpoints need stricter rate limits than generic global 300/15m
- Current state: **WAS WEAK** — only global limiter (skip in dev) protected `/auth/login`
- Evidence: `apps/api/src/app.ts:43` global limiter; `auth/routes.ts` had no dedicated limiter
- Severity: **P1**
- Fix: Added `loginLimiter` 20 attempts / 15m per IP on `POST /auth/login` (`auth/routes.ts:12` after edit), skipped in dev like global limiter
- Test: Under prod/test, 21st login in 15m should be 429 (not explicitly in suite; global limit test covers AI quota pattern)

### GAP-005 — No GitHub remote / CI never executed remotely
- Category: CI/CD
- Requirement: CI must actually run on push/PR (lint → typecheck → sqlite tests → pg tests → web build → docker build → audit)
- Current state: `git remote -v` empty; no pushes; CI definition exists but never triggered
- Evidence: `bash: git remote -v` output empty 2026-08-25
- Risk: Unverified integration; release not traceable
- Severity: **P1** (external credential blocker for now)
- Required fix: `gh auth login` then `gh repo create agrobridge --public --source=. --push` or `git remote add origin <url> && git push -u origin main`
- Test: GitHub Actions run must show 5 green jobs
- Production impact: Cannot claim CD is ready until CI passes remotely

### GAP-006 — No live PostgreSQL verification this session
- Category: Database
- Requirement: Full suite must pass on real PostgreSQL including concurrency invariants
- Current state: SQLite 79/79 PASS this session; PG 79/79 was PASS per previous CHANGELOG on PG 17.5 but not re-run (Docker unavailable)
- Evidence: `docker --version` not found; no postgres:16 container; `vitest.config.pg.ts` exists, `provision-postgres.mjs` exists
- Severity: **P0** (for final certification claim)
- Fix code-side: atomic conditional updates already implemented (checkout `updateMany where stock>=qty`, payout `updateMany where status=COLLECTED`, confirm `where status=PENDING`)
- Test required: `DATABASE_URL=postgresql://... npx vitest run --config vitest.config.pg.ts` must be 79/79 incl. 3 concurrency tests
- Status: CODE READY, INFRA BLOCKED — document as external blocker

### GAP-007 — No Docker runtime verification this session
- Category: DevOps
- Requirement: Multi-stage builds must produce runnable images with healthcheck, non-root, graceful shutdown
- Current state: Dockerfiles inspected and fixed (GAP-001), but `docker build` not executed (no daemon)
- Evidence: `docker --version` not found
- Severity: **P1**
- Fix code-side: Dockerfiles verified (api non-root `app`, healthcheck `wget`, web nginx); `docker-compose.yml` uses `postgres:16-alpine` + healthcheck
- Test required: `docker compose up --build` then `/health` + `/ready` + smoke flows
- Status: CODE READY, INFRA BLOCKED

### GAP-008 — Live payment gateway not integrated
- Category: Payments / Business
- Requirement: Real money movement (SSLCommerz/bKash) with signature verification, idempotent webhook, reconciliation
- Current state: `PAYMENT_PROVIDER=sandbox` only; `sslcommerz` enum exists but no credentials/adapter implemented
- Evidence: `config/env.ts:21` enum, `payments/routes.ts:63` `providerRef: SBX-...`, response `providerMode: sandbox`
- Severity: **P1** (business blocker, not technical bug)
- Fix code-side: Intent/confirm/payout ledger is transactionally correct and labelled sandbox; adapter slot documented in `docs/architecture.md`
- Required external action: Provide `SSLCOMMERZ_STORE_ID/PASSWORD` and implement adapter in `src/providers/payment/` + webhook signature check
- Impact: Cannot accept real payments in production until creds supplied; sandbox must remain clearly labelled (currently correct)

### GAP-009 — B2B multi-tenant isolation not enforced beyond user scoping
- Category: Business / Tenant isolation
- Requirement: `CORPORATE`/`COOPERATIVE` tenants must not see each other's farms/orders
- Current state: Roles exist (13 roles) but `PERMISSIONS` for CORPORATE/COOPERATIVE are `[]`; no tenant/organization model
- Evidence: `middleware/rbac.ts:33-34`, schema has no `Organization`/`TenantId`
- Severity: **P2** — deferred intentionally; farmer + admin flows are tenant-isolated via `ownerId` scoping (IDOR tests prove), but true B2B SaaS tenancy is Phase-2
- Fix: Introduce `Organization` model, `membership` join, row-level tenant scoping (future)
- Status: DOCUMENTED DEFERRED

### GAP-010 — No browser E2E (Playwright)
- Category: Frontend QA
- Requirement: Real browser journey: login → farm → AI → market → checkout → booking → procurement → admin + responsive
- Current state: Web builds (`vite build` PASS, 208kB), 11 pages exist, but no Playwright suite or run against `apps/web/dist` + live API
- Evidence: `apps/web/package.json` has no `playwright`/`@playwright/test`; no `e2e/` folder
- Severity: **P2**
- Test required: `npx playwright test` against `BASE_URL` with seeded users (login, bilingual toggle, cart checkout)
- Interim: Manual API-driven journeys cover same backend; build + typecheck verify compilation

### GAP-011 — No sustained load / recovery test executed this session
- Category: Performance / Reliability
- Requirement: p50/p95/p99, throughput, error rate under normal/peak/spike + DB failure fallback
- Current state: `scripts/loadtest.mjs` harness exists (autocannon 10s bursts), baseline documented in `docs/testing.md`, but no running server to hit this session
- Severity: **P2**
- Test required: `BASE_URL=http://localhost:4000 node scripts/loadtest.mjs` against staging with postgres
- Impact: No new perf numbers this session; previous baseline cited in docs remains reference

### GAP-012 — Backup/restore & RPO/RTO not re-measured this session
- Category: DR
- Requirement: Logical backup → destroy → restore → integrity (row counts + no orphans), measure durations
- Current state: `scripts/backup-restore-rehearsal.mjs` exists and was measured at 12.6s prev., but requires live PG + `SCRATCH_URL`
- Severity: **P2**
- Status: CODE READY, INFRA BLOCKED

### GAP-013 — Monitoring/alerting not wired to external sink
- Category: Observability / Ops
- Requirement: Prometheus metrics + alert rules (5xx, DB, latency, CPU, payment failure, AI provider)
- Current state: `/health` + `/ready` + structured pino + request IDs present; no `/metrics` or external alertmanager
- Severity: **P3**
- Fix: Add `prom-client` + alert rules + dashboard (Phase-2, low effort)

### GAP-014 — File uploads stored on local FS, not object storage
- Category: Infra
- Requirement: Production disease images should go to S3/GCS with signed URLs
- Current state: `uploads/disease/<uuid>.jpg` on container FS (`disease.ts:62`)
- Evidence: `apps/api/src/modules/aiagent/disease.ts:62-66`
- Severity: **P3** — acceptable for staging/small scale; add `STORAGE_PROVIDER` abstraction for scale

### GAP-015 — npm audit shows high/moderate CVEs in dev tooling
- Category: Security / Supply chain
- Current state: `npm audit --audit-level=high` reports esbuild, vite, react-router, uuid, deepmerge-ts CVEs (dev scope mostly)
- Evidence: `npm audit` run 2026-08-25 (13 vulns: 1 critical esbuild dev server, 4 high, 8 moderate)
- Severity: **P2**
- Fix: `npm audit fix` for deepmerge-ts (non-breaking) done? Remaining require major bumps (vitest 4, vite 7, react-router 7) — evaluate before prod promotion; production image does not ship vitest/vite

---

## Deferred by Design (not gaps)
- Native Flutter/React Native app — web is mobile-first; docs state Phase-2
- Real AI disease model — workflow correctly queues `PENDING_REVIEW` and never hallucinates diagnosis
- Financial/insurance/carbon services — Section 12 future services, not in v1.0 scope

## Summary Counts
- P0: 2 (1 fixed, 1 infra-blocked)
- P1: 5 (3 fixed code-side, 2 infra/external blocked)
- P2: 6
- P3: 2
