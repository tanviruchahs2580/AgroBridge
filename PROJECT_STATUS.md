# AgroBridge — Project Status (Takeover 2026-08-25)

**Vision:** Green Soil. Smart Farm. Secure Future.

This file is the source of truth for resumption if the session is interrupted.

## 1. Current Branch / Git
- Branch: `main` (clean after hardening commit below)
- Last commit: `03f47f6 docs: record hardening pass results ...` (previous hardening)
- Remote: **none configured** — external blocker (see GAP-018)
- Tags: none yet; release `v1.1.0` pending certification

## 2. What Exists (verified by inspection + execution 2026-08-25)

| Area | Status | Evidence |
|---|---|---|
| API (Express + TS strict) | ✅ Implemented | `apps/api/src/app.ts:23`, 79/79 vitest SQLite |
| Auth (JWT rotate + RBAC) | ✅ Hardened | bcrypt cost 12, refresh SHA256, suspension revocation, login brute-force limiter added |
| Farm domain | ✅ | farms → plots → crop cycles, lifecycle, calendar bilingual |
| Offline sync idempotency | ✅ | `clientUuid@unique` + replay test in `journey-farm` |
| Weather + risk engine | ✅ | mock + openweather with 8s timeout, risk derivation |
| AI Agent (offline + openai-compat fallback) | ✅ | KB retrieval, confidence, expert note, injection sanitize |
| Disease intake → review | ✅ | MIME+magic, 8MB, PENDING_REVIEW, admin review |
| Marketplace + atomic checkout | ✅ | atomic decrement via `updateMany where stock>=qty` |
| Membership discounts | ✅ | BRONZE 0 / SILVER 3% / GOLD 5% applied transactional |
| Services/bookings | ✅ | price estimate, assignment, lifecycle, rating aggregation |
| Procurement pipeline | ✅ | catalogue price + grade + moisture calc, state machine, atomic payout |
| Wallet/ledger | ✅ | WalletTransaction ledger, atomic increment |
| Notifications | ✅ | in-app persisted, bilingual titles |
| Admin control tower | ✅ | metrics, users, audit logs, AI usage |
| Observability | ✅ | /health, /ready, request IDs, pino redacted |
| Frontend (React/Vite/Tailwind) | ✅ | 11 pages, bn/en toggle, single-flight refresh |
| Docker | ✅ fixed | `docker/api.Dockerfile` now generates PG client for prod |
| CI | ✅ definition | `.github/workflows/ci.yml` 5 jobs (api sqlite + pg, web, docker, security) |

## 3. Verification Performed This Session (2026-08-25)
- Regenerated SQLite Prisma client (`prisma generate --schema prisma/schema.prisma`) — fixes host PG clobber
- `npm run typecheck` (api + web): PASS
- `npx eslint src tests`: PASS (0 errors)
- `npm run build` (api + web): PASS — web 208kB JS / 19kB CSS gzip 65kB
- `npx vitest run` (SQLite): **79/79 PASS** (31.6s)
- `npx prisma validate` PG schema (with dummy URL): PASS
- Secret scan: PASS (no private keys, no hard-coded postgres URLs)
- Fixed payment confirm race (conditional `updateMany` where PENDING)
- Added login rate limiter (20/15m)
- Fixed Docker prod generation (PG client + cp schema for migrate deploy)
- Fixed `tests/global-setup.ts` to auto-generate sqlite client before migrate

## 4. Known External Blockers (cannot be cleared without infra/creds)
- No Docker runtime on this Windows host → cannot build images or run postgres:16 compose
- No live PostgreSQL → PG full-suite (concurrency) not re-executed this session (previous pass was 79/79 on PG 17.5)
- No live payment gateway creds → sandbox is correct for now (explicit blocker)
- No GitHub remote → CI has not run remotely (definition verified locally)
- No TLS / production domain → staging/prod deploy not executed
- No native mobile app — web is mobile-first responsive, native is intentionally Phase-2

## 5. Next Steps (autonomous loop)
- Run PG suite when Docker/Postgres available (`npm run pg:provision && npm run test:pg`)
- Build docker images and `docker compose up --build` smoke test
- Run loadtest harness against staging
- Create GitHub repo + push `main` to trigger CI
- Tag `v1.1.0` after staging E2E

## 6. How to Resume
1. Read this file + `PRODUCTION_GAP_REGISTER.md` + `EXECUTION_LOG.md`
2. `npm run test --workspace apps/api` should be 79/79 (generates sqlite client automatically)
3. Inspect `git status` — should be clean after commit of hardening + status docs
4. Continue from TODO in gap register P0/P1

Last updated: 2026-08-25 06:40 UTC by Muse Spark takeover agent.
