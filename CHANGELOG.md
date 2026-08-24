# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com) ·
SemVer.

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
