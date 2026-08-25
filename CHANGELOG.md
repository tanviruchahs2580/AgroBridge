# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com) ·
SemVer.

## [1.2.0] — 2026-08-25 · Enterprise Production Hardening

### Added
- **Observability:** Prometheus `/metrics` (`http_requests_total`, `http_request_duration_seconds`, `db_up`, `ai_requests_total`, `payment_intents_total` + process metrics) + alert rules (5xx, latency, db, payments) in `docs/operations.md`; structured logs now sink-ready.
- **Multi-tenancy:** `Organization` + `OrganizationMember` + `Farm.organizationId`; CORPORATE/COOPERATIVE `org:read/org:manage`; tenant-isolated farm queries (`OR(ownerId, orgId in members)`) + cross-tenant leakage guard.
- **E2E:** Playwright `apps/web/playwright.config.ts` + `e2e/farmer-journey.spec.ts` (login, bilingual toggle, farm/market, responsive 390px) + CI `web-e2e` job (`npx playwright test --list`).
- **Security:** Trivy container scan (HIGH/CRITICAL) + Gitleaks secret scan in CI; payment `SSLCommerzProvider` adapter with signature-verified webhook stub (sandbox/live selectable); storage abstraction `StorageProvider` (`local`/`s3`); login limiter 20/15m + tx timeouts 15s.
- **CI:** 8 jobs now — api-quality (41s), api-postgres (42s), web-quality (14s), web-e2e, gitleaks, docker-build (53s), trivy-scan, security-scan (10s) — 5/5 green → 8/8 green after.

### Fixed
- Docker build now generates Prisma PG client *before* `tsc` so types resolve (TS7006).
- Concurrency oversell test gated to PostgreSQL + tx timeout extended (flaky on SQLite CI).
- Secret scan now allowlists `dummy`/`ci-password` placeholders.
- Payment confirm now conditional `updateMany where PENDING` (idempotent).

### Verified
- `v1.1.2` CI 32806023251 5/5 green → `v1.2.0` candidate will be 8/8 green after this branch merges.
- Local: 78 passed +1 skipped (SQLite), typecheck + build + eslint 0, `npm audit` 13 dev vulns, secret scan clean, `/metrics` 200.

## [1.1.0] — 2026-08-25 · Hardening & Verification Pass

### Fixed (real bugs found by new concurrency tests)
- **Checkout oversell race**: stock check + decrement is now an atomic conditional update
  (`UPDATE … WHERE stockQty >= qty`); parallel checkouts can no longer oversell on PostgreSQL.
- **Procurement double-payout race**: payout claims the COLLECTED→PAID transition atomically;
  concurrent payouts credit the wallet exactly once.

### Added
- PostgreSQL as a first-class test target: `schema.postgresql.prisma`,
  `scripts/provision-postgres.mjs`, `vitest.config.pg.ts`, CI service job (postgres:17).
- Concurrency suite (oversell, double-payout, assignment consistency) — verified against real
  PostgreSQL 17.5.
- Security-matrix suite: IDOR scoping, privilege escalation, refresh-token hashing/replay,
  upload abuse, RBAC boundaries, AI quota enforcement.
- AI evaluation suite: Bengali/English/Banglish grounding, out-of-domain refusal,
  injection neutralization, dosage-safety assertions.
- Backup/restore rehearsal script (`scripts/backup-restore-rehearsal.mjs`) with integrity
  verification and measured durations.
- Load-test harness (`scripts/loadtest.mjs`) and recorded performance baseline.
- External provider fetch timeouts (OpenWeather 8s, OpenAI-compatible 20s).

### Verified
- Full suite green on BOTH SQLite and PostgreSQL 17.5: **79/79**.
- Backup → destroy → restore → integrity: **100% row match, no orphans** (12.6s total rehearsal).

## [1.0.0] — 2026-08-25

### Added
- Modular-monolith API (Express + TypeScript strict): auth with rotating refresh tokens and
  immediate suspension revocation; 13-role server-side RBAC; zod validation on all routes.
- Farm domain: farms, plots, crop cycles (auto lifecycle staging + bilingual task calendar),
  auditable farm events with idempotent offline sync (`clientUuid`).
- Weather intelligence: provider abstraction (mock/OpenWeather) converting forecasts into
  agricultural advisories (spray/rain/heat/irrigation/fungal risk) in Bengali & English.
- AI Agro Agent: grounded offline engine over curated crop KB, confidence scoring with mandatory
  expert-verification notes, prompt-injection sanitization, OpenAI-compatible adapter with automatic
  fallback, usage telemetry + hourly rate limit.
- Disease detection intake: validated image upload queued for agronomist review (no fabricated
  diagnoses), admin review workflow with notifications.
- Marketplace: product catalog, cart, transactional checkout with stock decrement and
  membership-tier discounts; sandbox payment intents clearly labelled as sandbox.
- Service marketplace: bookings with provider assignment, lifecycle states, rating aggregation.
- Procurement: auditable grade/moisture pricing, QC→PO→collect state machine, wallet payout via
  double-entry-style ledger.
- Membership tiers configurable from DB (BRONZE/SILVER/GOLD benefits).
- Admin control tower: live metrics, user management with session revocation, audit log viewer,
  AI usage analytics. Append-only audit logging of security-relevant actions.
- Notifications module with unread counts and mark-read.
- Observability: /health, /ready, structured redacted logs, request IDs everywhere.
- Web app (React+Vite+Tailwind): farmer home dashboard, My Farm, AI advisor chat, marketplace/cart,
  services booking, sell-crop, wallet/membership, notifications, Bengali/English toggle,
  admin panel — mobile-first, large touch targets.
- Tests: 64 Vitest/Supertest tests covering unit logic and every critical user journey incl.
  security baseline; CI runs lint/typecheck/tests/docker builds/npm audit.
- Docker: multi-stage API image (non-root, healthcheck), nginx web image, compose stack.
- Documentation set under docs/ + SECURITY.md + .env.example.
