# Golden Baseline — Phase 0

**Generated:** 2026-09-02 (local, read-only, no push)
**Commit SHA (HEAD):** `849366f3407c3cc06d89c51aa05c1ecd12762ea7` (short `849366f`)
**Branch:** `main` — tag `v1.3.0` points to same commit family (see `git log --oneline -1`)
**Baseline Tag Reference:** `v1.2.0-easy-dashboard-20260828` (`b5bd1a8`) retained as revert base per `docs/versions/v1.2.0-easy-dashboard-20260828.md`

## CI Status (last push 2026-09-01T18:25:39Z)
- **CI `33543543427`:** 9/9 GREEN — `API Lint·TypeCheck·Tests (SQLite) 57s`, `API Integration & Concurrency (PostgreSQL 17) 54s`, `Web TypeCheck·Build 41s`, `Web E2E 1m31s`, `Android Build 2m2s`, `Gitleaks 10s`, `Dependency audit 13s`, `Docker Build 1m51s`, `Trivy HIGH/CRITICAL 1m38s` (0 HIGH)
- **CodeQL `33543543554`:** success `1m21s`
- Workflow file: `.github/workflows/ci.yml` (branches `[main,develop]`, concurrency `ci-${workflow}-${ref}` cancel-in-progress)

## Test Counts (audited 2026-09-02, no hand-typed numbers elsewhere per §11)
- **API:** 119 tests / 18 files (`apps/api/tests/*` — `vitest run`) — coverage gate `statements 75 / branches 63 / functions 73 / lines 75` (`apps/api/vitest.config.ts:28-33`), measured 80.05/67.76/78.57/80.05 (`vitest.config.ts:5`)
- **Web E2E:** 10 tests / 6 specs (`apps/web/e2e/*` — `playwright test` Pixel-5, `locale bn-BD`, `retries 0`, `trace on-first-retry` never fires)

## Coverage & Build Artifacts
- **Web build:** `vite build` → `dist/index.html` + `assets/index-JIQPEt9P.js` 441,293 B (raw) — verified `Get-FileHash` `7FC1AF14` cap synced to `android/app/src/main/assets/public/index.html`
- **API build:** `tsc -p tsconfig.build.json` → `apps/api/dist/server.js`
- **Docker images (local, not pushed — no digest):** `agrobridge-api:ci` / `agrobridge-web:ci` (`docker/api.Dockerfile`, `docker/web.Dockerfile`), `.dockerignore` excludes `.github/docs/*.md/.env/monitoring`
- **Android:** `versionCode 13000 / versionName "1.3.0"` (`apps/web/android/app/build.gradle`), artifact `agrobridge-debug-apk` from CI, local apk `agrobridge-final-v1.3.0-debug.apk` 6,678,352 B SHA256 `FB2DF4FB...61D191`

## Database Schema
- **Provider:** `sqlite` (`prisma/schema.prisma:6`) / `postgresql` variant (`schema.postgresql.prisma:6`), 519 lines identical
- **Migrations:** 5 — `20260824182238_init`, `20260825170000_add_organization`, `20260826092539_hardening_features` (contains SQLite `PRAGMA` — not portable), `20260826120628_order_shipping_fields`, `20260826140000_partial_payment_pending`
- **Lock:** `migration_lock.toml:3` = `sqlite`
- **Deploy path (current):** `render.yaml:16` `sed s/sqlite/postgresql/` + `prisma generate`, `preDeployCommand: prisma db push && prisma db seed` (drift risk — see Phase 10)

## Deployment IDs (observed, not deployed by this baseline)
- **Vercel web:** `https://agrobridge-web.vercel.app` live `index-Cm_o7Gsv.js` 441,281 B — **STALE vs HEAD** `JIQPEt9P` (live ≠ `849366f` build). Headers: HSTS only (Vercel default), CSP/XFO/Referrer/XCTO empty (contrast `docker/web.nginx.prod.conf:7`). `Cache-Control: public, max-age=0, must-revalidate`. PWA manifest `theme #166534 / bg #fafaf9` (`vite.config.ts:35-36`).
- **Render API:** `agrobridge-api-node` (free, Oregon, `render.yaml:11`) — not probed anonymously; verified locally via `docker-compose.prod.yml` healthchecks
- **Local preview:** `http://localhost:5173` (Vite) / `:4173` (preview) / `http://192.168.0.107:5173` LAN

## Dependabot & Governance (frozen for remediation)
- **Dependabot:** weekly `npm` + `github-actions` (`.github/dependabot.yml`), 10 OPEN PRs (#3–#12) — frozen per Phase 0 until Sprint 3
- **Branch protection:** NONE on `main` (API 404), no `CODEOWNERS`
- **Releases:** `v1.1.2`, `v1.2.0`, `v1.3.0` (no assets on `v1.3.0`)

## Notes (read-only)
- This file is CI-generated per §11; do not hand-edit counts. Next runs must overwrite from `vitest --coverage` / `playwright --list` output.
- No push/commit/CI was triggered to produce this baseline (per current execution constraint).
