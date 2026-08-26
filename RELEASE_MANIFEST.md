# AgroBridge — Release Manifest

Version: **v1.5.0** (candidate — Production Hardening & Product Transformation)
Date: 2026-08-26
Previous release: `v1.3.0` (2026-08-25). Full delta: see CHANGELOG 1.5.0.

> Historical note: sections below describe the v1.1.1 manifest and are retained for
> provenance; current-state deltas (9 CI jobs incl. real E2E/coverage gates, prod
> compose, monitoring files, legal docs, withdrawal/refund/OTP flows) are listed in
> CHANGELOG `[1.5.0]` and `PRODUCTION_GAP_REGISTER.md`.

## Current known limitations (v1.5.0 go/no-go)
1. Live payment gateway credentials + webhook endpoint URL not yet provisioned (SSLCommerz).
2. No production host/TLS/staging yet (`docker-compose.prod.yml`, TLS nginx conf and
   deploy scaffold ready; requires operator secrets + domain).
3. Signed AAB pending keystore generation (`android-release.yml` workflow ready, secrets-based).
4. Monitoring sink not deployed (prometheus.yml/alert_rules.yml/dashboard shipped in repo).
5. SMS gateway adapter is sandbox/log-only until a provider account exists.
6. Real-device UAT with farmers outstanding (script: docs/uat-script.md).

---

# Historical manifest (v1.1.1) — retained

Version: **v1.1.1** (candidate, patch over `v1.1.0` hardened baseline)
Date: 2026-08-25
Commit: (hardening fixes — payment confirm race, login limiter, docker PG client, test generation)
Previous release: `v1.1.0` (2026-08-25, see CHANGELOG) — 79/79 on both SQLite + PG 17.5, backup 12.6s

## Artifacts

### Source
- `apps/api/` — Express + TS strict API (Prisma ORM, zod, helmet, rate-limit)
- `apps/web/` — React 18 + Vite 6 + Tailwind 3 SPA (bn/en, 11 pages)
- `apps/api/prisma/schema.prisma` — SQLite dev/test datasource
- `apps/api/prisma/schema.postgresql.prisma` — PostgreSQL prod datasource
- `apps/api/prisma/migrations/20260824182238_init/` — initial migration (portable)
- `apps/api/prisma/seed.ts` — demo users/products/services/plans (public demo creds only)

### Built Outputs
- `apps/api/dist/` — `tsc -p tsconfig.build.json` output (ESM)
- `apps/web/dist/` — `vite build` (45 modules, `index-Cp-lzY2q.css` 19kB, `index-BhfSST6x.js` 208kB gzip 65kB)

### Containers
- `docker/api.Dockerfile` — multi-stage Node 22 alpine → runtime `app` user, HEALTHCHECK wget, PG client (fixed this release)
- `docker/web.Dockerfile` — multi-stage Node 22 alpine → nginx 1.27 alpine, healthcheck
- `docker/web.nginx.conf` — SPA + `/api` reverse proxy
- `docker-compose.yml` — `db` (postgres:16-alpine + healthcheck), `api` (env: DATABASE_URL, WEB_ORIGIN, JWT secrets, providers), `web` (80→ API)

### CI/CD
- `.github/workflows/ci.yml` — 5 jobs: `api-quality` (lint/typecheck/sqlite suite), `api-postgres` (PG 17 service + full suite), `web-quality` (build), `docker-build` (api+web images), `security-scan` (npm audit + secret grep)

### Configuration
- `.env.example` — all variables (DB, JWT, rate limit, weather/AI/payment/SMS providers)
- `apps/api/.env` — development defaults (not committed as real secrets)
- `docs/deployment.md` — env ↔ compose ↔ bare-metal steps, rollback
- `docs/disaster-recovery.md` — backup policy, rehearsal evidence, restore + rollback procedures

### Scripts & Verification
- `apps/api/scripts/provision-postgres.mjs` — PG schema push + PG client generate + seed
- `apps/api/scripts/backup-restore-rehearsal.mjs` — logical dump → scratch DB restore → row-count + orphan verify
- `apps/api/scripts/loadtest.mjs` — autocannon 10s bursts for health/products/login/weather/AI

### Documentation
- `README.md` — quickstart, demo creds, doc index
- `docs/architecture.md`, `docs/api.md`, `docs/database.md`, `docs/ai.md`, `docs/security.md`, `docs/testing.md`, `docs/deployment.md`, `docs/operations.md`, `docs/disaster-recovery.md`, `docs/troubleshooting.md`
- `CHANGELOG.md`, `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`

### Reports (this hardening pass)
- `PROJECT_STATUS.md`
- `PRODUCTION_GAP_REGISTER.md`
- `EXECUTION_LOG.md`
- `PRODUCTION_CERTIFICATION_REPORT.md`
- `PERFORMANCE_REPORT.md`
- `DISASTER_RECOVERY_REPORT.md`
- `RELEASE_MANIFEST.md` (this file)

## Installation
```bash
npm ci
npm run db:migrate --workspace apps/api   # uses schema.prisma (sqlite dev)
npm run db:seed --workspace apps/api
npm run dev --workspace apps/api          # :4000
npm run dev --workspace apps/web          # :5173 proxies /api
```

## Production Deploy (summary)
```bash
export DATABASE_URL=postgresql://user:pass@host:5432/agrobridge
export JWT_ACCESS_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)
export WEB_ORIGIN=https://agro.example.com
# Optional: WEATHER_PROVIDER=openweather OPENWEATHER_API_KEY=... AI_PROVIDER=openai-compatible OPENAI_API_KEY=...
docker compose up --build -d
docker compose exec api npx prisma migrate deploy
curl -f http://localhost:4000/health && curl -f http://localhost:4000/ready
```

## Demo Credentials (public, never prod)
| Role | Phone | Password |
|---|---|---|
| SUPER_ADMIN | 01700000000 | Demo@1234 |
| ADMIN | 01700000001 | Demo@1234 |
| FARMER | 01700000002 | Demo@1234 |
| DEALER | 01700000003 | Demo@1234 |
| PROCUREMENT_MANAGER | 01700000004 | Demo@1234 |

## Known Limitations for v1.1.1
- Sandbox payments only (real gateway needs creds + webhook signing)
- B2B multi-tenant org model deferred (single-tenant user-scoped isolation verified)
- No Playwright browser E2E in image (API journeys cover backend; web build verified)
- Monitoring is health/ready + logs only (prom/alertmanager Phase-2)
- Dependency audit shows dev-scope CVEs (esbuild/vite/react-router) — prod image unaffected

## Integrity
- `git status` clean after commit of hardening + docs
- Tests: 79/79 PASS (SQLite, `npx vitest run` 2026-08-25)
- PG 79/79 previously PASS on 17.5; re-run required on live PG for final tag

