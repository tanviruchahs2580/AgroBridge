# AgroBridge — Enterprise Architecture & Full QA Audit

**Audit date (UTC):** 2026-09-11
**Auditor role:** Principal/Staff Enterprise Architect + QA/Security/SRE (independent due-diligence)
**Methodology:** Enterprise Architecture + Full QA Master Review (evidence-over-assumption; every material finding labelled `VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / FAILED`)
**Subject:** `C:\Users\DST\projects\Agro bridge app` (branch `main`, HEAD `530977d`), plus uncommitted working-tree changes
**Prior audit referenced:** `ENTERPRISE_QA_AUDIT_REPORT_2026-09-10.md` (claims 79.2/100, NOT production ready) — drift vs. current state is called out explicitly where found.

> Note: the master-prompt template names a different app ("Bangla GPT"). The repository actually under audit is **AgroBridge — Integrated Digital Agriculture Platform**. This report audits what exists.

---

## 1. Executive Summary

AgroBridge is a **real, working, modular-monolith farm platform** (Express+Prisma API, React+Vite PWA, SQLite→PostgreSQL path), not a mockup. I executed the full verification loop myself on 2026-09-11: **API typecheck PASS, Web typecheck PASS, API build PASS, Web build PASS, API ESLint clean (0 errors), 125/125 API tests PASS (+1 skipped), 91/91 Web unit tests PASS, live HTTP smoke (register→login→me→AI advisory→RBAC denial) PASS, `/health` + `/ready` (db:true) PASS.**

Genuine engineering strengths: bcrypt-12 + rotating refresh tokens with reuse detection, 13-role server-side RBAC, transactional marketplace checkout, ledger-guarded wallet (working tree), grounded offline AI with eval + regression suites, honest disease-intake (never fabricates diagnosis), zod validation, helmet/CORS/rate-limit, structured logs with request IDs, `/metrics` guard, production bootაძლ guard refusing weak secrets/placeholder providers without explicit opt-in, and a 9-job CI pipeline (quality → PG suite → E2E → APK → gitleaks → docker → trivy → audit).

Material gaps blocking full production: **(1)** three database dumps containing bcrypt password hashes + phone numbers are **committed to git**; **(2)** production as-configured (`render.yaml`) runs on **placeholder providers** (mock weather / offline KB / sandbox payments) with `ALLOW_PLACEHOLDER_PROVIDERS=1`; **(3)** real money movement is impossible today (sandbox only; SSLCommerz verify chain is new, uncommitted, untested); **(4)** the AI is a 7-entry keyword KB (RAG-lite), not an LLM system — adequate for pilot FAQs, not for open-domain agronomy; **(5)** the working tree carries significant **uncommitted** fixes (wallet guards, SSLCommerz verify, offline-queue dedupe, session single-truth, composite indexes) — HEAD is behind the tested code; **(6)** no tracing, no alert delivery, no tested RPO/RTO; **(7)** coverage sits exactly on the threshold (75.28% vs 75%) with 0% on payment/storage/AI-LLM adapters.

**Overall Production Readiness: 69.0/100 — ⚠️ CONDITIONAL (controlled pilot only), ❌ NOT ready for full production.**

---

## 2. Audit Scope

| Area | Covered | How |
|---|---|---|
| Repository discovery, architecture map | ✅ | Full tree reads of `apps/api`, `apps/web`, `.github`, `docker`, `docs` |
| Architecture audit (FE/BE/data/AI) | ✅ | Source reads: `app.ts`, `server.ts`, `env.ts`, all routers, providers, Prisma schemas |
| Feature inventory vs. mocks | ✅ | Route-by-route + page-by-page mapping |
| Functional QA with execution | ✅ | 125 API + 91 Web tests run; live smoke on ports 4127–4129 |
| Testing audit | ✅ | Coverage run (75.28/67.23/77.31), thresholds, e2e spec inventory (not executed) |
| Security / DevSecOps | ✅ | Secret grep, `npm audit --json`, boot-guard read, RBAC/IDOR live test, CI YAML reads |
| Privacy / data governance | ✅ | Storage, retention, deletion (`DELETE /me`), provider data-flow reads |
| Performance / scalability | ✅ | Bundle sizes measured, index diff, no loadtest executed (marked UNVERIFIED) |
| Reliability / SRE | ✅ | `/health`, `/ready`, shutdown, fallback chains, backup-rehearsal script (not executed) |
| AI quality + Bangla engineering | ✅ | KB/engine source reads, AI eval suites executed via vitest |
| UX / accessibility | ✅ | Static review + e2e/a11y spec inventory; no browser session (PARTIALLY VERIFIED) |
| CI/CD / release | ✅ | All 8 workflows + Dockerfiles + composes + `render.yaml` read |
| Anti-patterns / tech debt | ✅ | Grep + read-based |

What was **not** done (explicit): Playwright E2E not executed (needs browsers + 2 servers); PostgreSQL live suite not executed (no PG server here; CI covers it); load test not executed; S3/SSLCommerz/OpenWeather live calls not executed (no credentials — by design); mobile APK not installed.

---

## 3. Repository Snapshot

- **Branch:** `main` — HEAD `530977d` ("fix: NGINX proxy /api/v1/health routing + finalize enterprise audit remediations")
- **Recent history (VERIFIED `git log`):** rapid remediation cadence — Render cold-start/CORS fixes, APK 1.3.3→1.3.7 bumps, UX audit waves, placeholder-provider gate (`e02560e`), debug-APK workflow.
- **Uncommitted changes (VERIFIED `git status --short`):** 11 modified files — `apps/api/prisma/schema.prisma`, `auth/routes.ts`, `payments/refund.service.ts`, `payments/wallet.service.ts`, `payment/sslcommerz.ts`, `payment/types.ts`, `web/src/lib/api.ts`, `offlineQueue.ts`, `offlineQueue.test.ts`, `session.tsx`, `render.yaml`. **All test/build evidence in this report reflects the working tree, not HEAD.**
- **Untracked clutter (VERIFIED):** 7–8 `agrobridge-final-v1.3.x-debug.apk` (~6.4 MB each, ~50 MB), `New folder/` (8 personal photos ~1.8 MB), `tmp_fix_routes.mjs`, `apps/web/e2e/gui-e2e-test.spec.ts`, `visual-contract.spec.ts-snapshots/`, `visual-contract.spec.ts.bak`, `docs/ux-audit-2026-09-03/`.
- **Tracked artifacts that should not be (VERIFIED `git ls-files`):** `apps/api/backup-1787603760600.json`, `backup-1787603867609.json`, `backup-1787603968929.json` (~650 KB each).
- **Remote:** `git remote -v` could not be verified in this shell (PowerShell job isolation); CI references `tanviruchahs2580/AgroBridge`.

---

## 4. Technology Stack (VERIFIED via manifests)

| Layer | Choice | Evidence |
|---|---|---|
| API runtime | Node ≥20 (CI 22, Docker `node:22-alpine`), Express 4.21, TypeScript 5.7 (`strict:false`) | `apps/api/package.json`, Dockerfiles, `tsconfig.json` |
| Validation/Auth | zod 3.24, bcryptjs (cost 12 prod / 4 test), jsonwebtoken 9 | `auth/routes.ts:88`, `env.ts` |
| DB/ORM | Prisma 6.5/6.19, SQLite dev/test → PostgreSQL prod (dual schema files) | `prisma/schema.prisma` + `schema.postgresql.prisma` |
| Hardening | helmet 8, cors, express-rate-limit 7 (+ioredis optional), pino 9, prom-client 15 | `app.ts`, `package.json` |
| Web | React 18.3, Vite 6, react-router-dom 7, TanStack Query 5, Tailwind 3.4, PWA (`vite-plugin-pwa`), Capacitor 8 | `apps/web/package.json`, `vite.config.ts` |
| Tests | Vitest 3 (+coverage-v8, thresholds 75/63/73/75), supertest, Playwright 1.62, jsdom | `vitest.config.ts`, `package.json` |
| CI/CD | GitHub Actions (9-job `ci.yml`), CodeQL, Gitleaks, Trivy (HIGH/CRITICAL gate), Dependabot weekly | `.github/workflows/` |
| Deploy | Render (`render.yaml`), GHCR images + staging VM, Vercel (web), Fly (`fly.toml`), APK via Capacitor | `render.yaml`, `docker-compose*.yml` |

---

## 5. Actual Architecture

Modular monolith, cleanly layered. **No microservices, no message queue, no vector DB, no LLM streaming** — and the code is honest about that.

```text
Farmer / Admin (PWA + Capacitor APK, bn-first)
 ↓  HTTPS — same-origin nginx /api proxy  OR  VITE_API_BASE_URL (APK)
Web (React 18, RRv7, QueryClient, sessionManager single token truth,
     offlineQueue [events|cart|orders], PWA SW precache + runtime cache)
 ↓  REST /api/v1  (envelope {ok,data|error,requestId}, Zod validate, requestContext)
API (Express: helmet → cors → json limits → requestId → metrics → rate-limit → v1 router)
 ├─ middleware: requireAuth (JWT + DB status check) → requirePermission (13-role map + policy.ts)
 ├─ modules: auth | farms | weather | aiagent(+disease) | marketplace | services
 │           | procurement | payments(+wallet/membership/webhook) | notifications
 │           | admin | organizations | analytics
 ├─ providers (abstracted): ai(offline-engine | openai-compatible) · weather(mock | openweather)
 │                         · payment(sandbox | sslcommerz) · storage(local | s3) · sms(sandbox | none)
 ├─ data: Prisma → SQLite (dev/test) / PostgreSQL (prod) · 30 models · ledger-style wallet
 └─ observability: pino + secret redaction, request IDs, prom-client /metrics (guarded),
                  /health + /ready (SELECT 1), AuditLog, AiUsageLog, AnalyticsEvent
```

Key structural facts (VERIFIED):
- `src/app.ts` (121 lines): `createApp()` wires helmet → CORS (comma-split `WEB_ORIGIN`, credentials) → 1 MB JSON / 200 KB urlencoded limits → context/metrics → global `/api/` rate-limit (**skipped when `NODE_ENV=development`**, `app.ts:60`) → `/health`, `/ready` (real `SELECT 1`), `/metrics` (private-net or `METRICS_TOKEN` in prod) → `/api/v1` router → 404 + error handler (reference IDs `AB-XXXXXX`, P2002→409, P2025→404).
- `src/server.ts` (31 lines): graceful SIGTERM/SIGINT + `prisma.$disconnect()`, unhandled-rejection logging.
- `src/config/env.ts` (90 lines): zod env + **production fail-fast** — refuses weak JWT secrets; refuses placeholder providers unless `ALLOW_PLACEHOLDER_PROVIDERS=1`; refuses missing provider keys. This is genuinely good enterprise practice.
- 30 Prisma models (VERIFIED by `^model` count), string-typed roles/statuses (SQLite limitation), dual-schema maintenance burden.
- 13 roles: SUPER_ADMIN/ADMIN/REGIONAL_MANAGER/AREA_MANAGER/PROCUREMENT_MANAGER/WAREHOUSE_MANAGER/COLLECTION_MANAGER/FIELD_AGENT/SERVICE_PROVIDER/DEALER/CORPORATE/COOPERATIVE/FARMER, enforced server-side via `PERMISSIONS` + `policy.ts` (`can()/assertCan()`).

---

## 6. Architecture Diagram — see §5 (matches the implemented system; no invented RAG/vector/queue components).

---

## 7. Feature Inventory (evidence-graded)

| Feature | UI | Backend | Data | AI | E2E verified | Status |
|---|---|---|---|---|---|---|
| Phone register/login/logout, refresh rotation + reuse detection, OTP verify | ✅ | ✅ | ✅ | — | ✅ VERIFIED (live + `journey-auth`, `auth-hardening`) | **Functional** |
| Session persistence, suspension revokes tokens, self-delete `DELETE /me` | ✅ | ✅ | ✅ | — | ✅ (tests; delete-guard new in worktree) | **Functional** |
| Farms→plots→crop cycles, lifecycle staging, task calendar | ✅ | ✅ | ✅ | — | ✅ (`journey-farm`) | **Functional** |
| Offline-tolerant farm-event sync (`clientUuid` idempotency) | ✅ | ✅ | ✅ | — | ✅ (+ web `offlineQueue.test`, 26 tests) | **Functional** |
| Weather → agri risk advisories (bn+en) | ✅ | ✅ (mock default) | — | — | ✅ (`journey-weather-ai-disease`) | **Functional w/ mock** |
| AI Agro Agent (KB-grounded, confidence, expert-note, sanitization, telemetry, budget guard, offline fallback) | ✅ | ✅ | ✅ (`AdvisoryQuery`, `AiUsageLog`) | ✅ RAG-lite | ✅ (`ai-eval` 7 + `ai-retrieval-regression` 5) | **Functional, narrow KB** |
| Disease intake → `PENDING_REVIEW` agronomist workflow (never auto-diagnoses) | ✅ | ✅ (8 MB, magic-byte per code) | ✅ | — | ✅ | **Functional, honest scope** |
| Marketplace catalog/cart/checkout (atomic stock, tier discounts, delivery fee) | ✅ | ✅ | ✅ | — | ✅ (`journey-marketplace`, concurrency) | **Functional** |
| Sandbox payments + wallet ledger + withdrawals + refunds | ✅ | ✅ | ✅ | — | ✅ (`payments-integrity` 9, `wallet-withdrawals` 6) | **Functional as sandbox** |
| Service bookings lifecycle + provider assign + ratings | ✅ | ✅ | ✅ | — | ✅ (`journey-services-procurement`) | **Functional** |
| Procurement offers → QC state machine → wallet payout | ✅ | ✅ | ✅ | — | ✅ (+ concurrency payout-once) | **Functional** |
| Admin control tower (metrics/users/audit/AI usage/withdrawals) | ✅ | ✅ | ✅ | — | ✅ (`journey-admin`, `rbac-fixes`) | **Functional** |
| Organizations + members + org farms | ✅* | ✅ | ✅ | — | ⚠️ PARTIALLY (routes exist; journey coverage thin) | **Partially verified** |
| Notifications + preferences | ✅ | ✅ | ✅ | — | ✅ | **Functional** |
| Real SSLCommerz charging | ❌ | ⚠️ adapter only | ✅ | — | ❌ UNVERIFIED (no creds; new verify chain uncommitted+untested) | **Not functional** |
| Real SMS/OTP delivery | ❌ | ❌ (`sandbox|none`) | — | — | ❌ | **Placeholder by design** |
| LLM answers (OpenAI-compatible) | ✅ (same UI) | ⚠️ provider exists | ✅ | ⚠️ | ❌ UNVERIFIED (9% coverage, no key, no eval) | **Unverified path** |
| Streaming, voice input, vector RAG, citations | ❌ | ❌ | ❌ | ❌ | — | **Absent (correctly not claimed)** |

\* Organizations UI presence inferred from routes + nav; not click-verified in a browser.
**No fake functionality found.** Every button-flow I traced has a backing route; sandbox/payment and mock-weather are explicitly labelled, not disguised.

---

## 8. End-to-End Functional QA (executed 2026-09-11)

| Check | Result | Evidence |
|---|---|---|
| API typecheck | ✅ PASS | `tsc -p tsconfig.build.json`, 0 errors |
| Web typecheck | ✅ PASS | `tsc --noEmit`, 0 errors |
| API build | ✅ PASS | `tsc -p tsconfig.build.json` |
| Web build | ✅ PASS | Vite 9.40s; `index-*.js` 448.51 kB / gzip 143.53 kB; PWA 39 precache entries 1383.68 KiB |
| API ESLint | ✅ 0 errors | `eslint src tests` clean |
| Web ESLint | ⚠️ 0 errors, **34 warnings** (unused vars, exhaustive-deps) | `eslint src` |
| API tests | ✅ **125 passed, 1 skipped, 19 files** in ~49–77s | `vitest run` (twice, incl. `--coverage`) |
| Web unit tests | ✅ **91 passed, 4 files** | `test:unit` |
| PG schema | ✅ valid (with PG URL); ❌ fails with local SQLite URL (environmental, expected) | `prisma validate` both ways |
| Live `/health` | ✅ `{ok:true, service:agrobridge-api}` | ports 4123/4127 |
| Live `/ready` | ✅ `{ok:true, ready:true, db:true}` | port 4127 |
| Live register→login→me | ✅ FARMER role; envelope+requestId shape confirmed | port 4129 |
| Live invalid phone `011…` | ✅ 400 rejected (BD regex `^01[3-9]\d{8}$`) | port 4128 |
| Live AI advisory (ASCII-escaped harness artifact) | ✅ honest 0.3/low/refusal path exercised | port 4129 |
| Live farmer→`/admin/metrics` | ✅ denied | port 4129 |
| Live unauthenticated `/auth/me` | ✅ `UNAUTHORIZED` + `AB-…` reference | port 4128 |
| Playwright E2E (7 specs) | ❌ NOT executed here | UNVERIFIED (CI runs them) |
| PG live suite | ❌ NOT executed here | UNVERIFIED (CI `api-postgres` covers) |
| Load test | ❌ NOT executed | UNVERIFIED (`scripts/loadtest.mjs` exists) |

Docs-drift note: README claims "64 tests" and `PROJECT_STATUS.md` claims "79/79" — both stale. Actual: **125 API + 91 web = 216**.

---

## 9. AI/LLM Architecture Audit

- **What it is (VERIFIED):** RAG-lite over a **7-entry curated KB** (`knowledge.ts`: rice-blast, rice-urea, wheat-rust, jute-stem-rot, mustard-aphid, soil-test, irrigation-general) with crop-alias weakening, phrase-priority scoring, topical-gate (bare crop mention never grounds), Bengali normalization (য়-collapsing, hasanta/ZWJ stripping), Banglish aliases, `sanitizeQuestion()` (code-fence strip, role-prefix strip, `<>` strip, 1000-char cap), calibrated confidence (match-strength, not stored value), low-confidence expert-verification note, `AdvisoryQuery` persistence, `AiUsageLog` telemetry, monthly budget guard (429 in prod / offline fallback in dev), OpenAI-compatible provider with offline fallback on failure.
- **What's genuinely good:** honesty under uncertainty (refusal template + `lowConfidenceFlag`), injection neutralization (tested with 3 attack shapes), regression discipline (v1.3.6 live-review failures encoded as tests), no fabricated dosages (verification-guidance assertion).
- **Limits (VERIFIED):** 7 entries ≈ FAQ demo, not agronomy coverage; `openai-compat.ts` at **9.09% coverage**; no streaming/SSE; no eval harness for the LLM path; token accounting only on the LLM path; Bangla quality of LLM path UNVERIFIED (no key).
- **Verdict:** well-engineered for what it claims; do not present it as "AI agronomist" breadth.

---

## 10. Bangla Language Quality Audit (VERIFIED)

- bn-first i18n dict (~200+ keys, `t(key,lang,vars)`), `<html lang=bn>`, persisted `langPref`, header toggle, `document.title` per route.
- Fonts: Hind Siliguri + Noto Sans Bengali self-hosted w/ unicode-range subsets + Inter; `tokens.css`/`dark.css` theming.
- Formatting: `Intl.NumberFormat(bn-BD, BDT)`, `Intl.DateTimeFormat(bn-BD)`, `Intl.PluralRules(bn)`.
- Retrieval normalization handles য় variants, joiner spellings, Banglish ("paani/sinchon/dhan/gom/paat/shorisha") — all covered by passing tests.
- Gaps: no ZWJ/ZWNJ-sensitive search beyond joiner-stripping (acceptable), no voice input (not claimed), mobile-keyboard behavior UNVERIFIED in browser, `mixed-script` beyond tested cases PARTIALLY VERIFIED.

---

## 11. RAG/Knowledge Audit

There is **no vector RAG** (no embeddings, no vector store, no chunking, no reranking, no citations) — correctly absent, not missing-and-claimed. The KB is a static curated array: no ingestion pipeline, no versioning, no freshness metadata, no duplicate handling, no retrieval-quality dashboard beyond vitest. Recommendation: keep KB for pilot; graduate to versioned KB documents + eval set before any LLM launch (roadmap Phase 3).

---

## 12. Database & Data Architecture (VERIFIED)

- 30 models; relations cover users→farms→plots→cycles→events, commerce, bookings, procurement→payout→wallet ledger, OTP, notifications, audit, AI usage, orgs.
- Integrity: refresh-token reuse detection revokes family; checkout decrements stock transactionally; procurement payout credits once under concurrency (tested); `onDelete: Restrict` on wallet owner; `DELETE /me` blocked with pending orders/withdrawals (worktree) + anonymizes.
- **Working-tree hardening (UNCOMMITTED):** composite `@@index([status, createdAt])` on Order/Payment/Withdrawal; atomic non-negative wallet guards in `debitWallet`/`createDoubleEntry`/refund path.
- Gaps: roles/statuses as plain Strings (typo-able, no DB enum on PG either); `Payment.userId` relation weakness carried over from prior audit (still no FK relation — PARTIALLY VERIFIED, needs schema read to close); dual-schema files can drift (mitigated by CI validating PG variant); no backup schedule/RPO/RTO evidence beyond `backup-restore-rehearsal.mjs` (UNEXECUTED); **committed DB dumps (SEC-001)**.

---

## 13. Security Audit

### VERIFIED strengths
- bcrypt cost 12 (4 in test), uniform `401 Invalid credentials`, BD phone regex, `phoneVerified` gating for payouts/withdrawals.
- Refresh rotation (48-byte random, SHA-256 at rest) + single-use + replay revokes whole family; logout revokes; admin role/status change revokes sessions.
- `requireAuth` re-reads `User.status` (SUSPENDED/DISABLED instantly locked out) and takes role from DB, never the token alone.
- 13-role server-side RBAC + `policy.ts`; farmer→admin live-denied; tenant isolation + IDOR suites pass.
- zod on body/query/params; 1 MB JSON / 200 KB urlencoded caps; disease upload 8 MB + image magic-byte check (code) + local|S3 abstraction.
- helmet, restrictive CORS (`WEB_ORIGIN` allow-list + credentials), global + per-route rate limits (login 20/15m, OTP 5/h, register 10/h, AI 30/h), optional Redis store, `TRUST_PROXY` configurable.
- `/metrics` private-net or token in prod; pino secret redaction; request IDs end-to-end; error references without stack leaks in prod.
- **Secret grep over tracked non-doc files: zero hits** for `sk-*`, `AKIA*`, private keys, embedded DB passwords.
- Production boot guard (`env.ts`) — genuinely enterprise-grade fail-fast.
- Runtime deps carry **no high/critical** advisories (all 5 HIGHs are toolchain: prisma/vite/js-yaml/deepmerge-ts).

### Findings
- **SEC-001 (P1): tracked DB dumps with credential hashes + phone numbers** — `apps/api/backup-*.json` (3× ~650 KB, 244 users, 283 refresh-token hashes, audit logs). Demo passwords are public, but hashes + PII-shape data in git history trip scanners and normalize a dangerous practice. Purge via `git filter-repo` + rotate any overlapping secrets. (VERIFIED)
- **SEC-002 (P2): no `.gitignore` for `*.apk`, backups, work scripts** — ~50 MB APKs + photos + `tmp_fix_routes.mjs` sit uncommitted today; one careless `git add -A` commits them. (VERIFIED)
- **SEC-003 (P2): `npm audit --audit-level=high` is warn-only in CI; waiver `GHSA-5xrq` expires 2026-09-30** (19 days). Runtime is clean, but the gate has no teeth. (VERIFIED)
- **SEC-004 (P3): global rate-limit skipped in `development`** — dev/staging behavior diverges from prod; ensure staging runs `NODE_ENV=production`. (VERIFIED `app.ts:60`)
- MFA: absent (P3 — acceptable for farmer pilot, required for enterprise roadmap).

---

## 14. Privacy & Data Governance

- Conversations (`AdvisoryQuery`), uploads (disease images), locations (farm lat/lng), phones, wallet ledger persist server-side; **no retention/deletion schedule** beyond self-delete; self-delete anonymizes profile + revokes tokens (VERIFIED code) but historical advisory/audit rows' fate on delete is UNVERIFIED — confirm cascade/anonymization policy.
- Third-party egress today: none by default (all providers placeholder/local). Enabling OpenAI/OpenWeather/SSLCommerz/S3 will export questions, IPs/coords, payment data, images respectively — needs a data-flow notice + consent before flipping providers.
- `PRIVACY_POLICY.md`/`TERMS_OF_SERVICE.md` exist (content review out of scope); `security@agrobridge.example` is a placeholder (must be replaced pre-launch).
- Masked phone logging for OTP sandbox (code) — good; verify no raw image/answer PII in logs (PARTIALLY VERIFIED via redaction lib, not fuzz-tested).

---

## 15. Performance Audit

- **Measured:** web `index` chunk 448.51 kB (gzip 143.53 kB) — acceptable; per-route code-splitting present (13 lazy pages); PWA precache 1.38 MB.
- API p50/latency: NOT measured here (UNVERIFIED). Pagination on list endpoints: PARTIALLY VERIFIED (admin users paginated; verify products/orders/notifications cursors).
- DB: composite indexes added in worktree (uncommitted); N+1 sweep not performed — recommend `prisma` query-log review pre-scale (P2).
- Model latency: offline engine is sub-100 ms class (inferred from 11.83 s total test time over 125 tests — not a benchmark).
- Real bottleneck is hosting: Render free-tier cold starts (~30 s; APK timeout already raised 10 s→30 s). Paid tier or warm-up is a launch prerequisite.

---

## 16. Scalability Assessment

| Scale | Assessment |
|---|---|
| 100 users (pilot) | ✅ Fine on single instance + SQLite→PG. AI offline is free and instant. |
| 1,000 users | ⚠️ Needs PG (done via schema variant), Redis rate-limit (`REDIS_URL`), S3 uploads, paid hosting. All are config-only — good. |
| 10,000 users | ⚠️ Needs read-replica/caching strategy, AI budget enforcement (exists) + LLM queue, background jobs (payouts/notifications currently inline), log aggregation. None exist yet. |
| 100,000 users | ❌ Requires horizontal statelessness review (local uploads + in-memory single-flight refresh are per-instance), queue/worker split, CDN, multi-AZ DB, full observability. Architectural evolution, not tuning. |

Cost exposure: offline AI ≈ 0; LLM path has monthly soft-budget guard (VERIFIED code) but `AI_COST_PER_1K_TOKENS_PAISA=0` default disables it — must be priced before enabling.

---

## 17. Reliability/SRE Audit

- VERIFIED: `/health` + `/ready` (DB check), graceful shutdown, provider fallbacks (LLM→offline, budget→offline/429), webhook idempotency shape, offline queue with retry budget, audit + usage telemetry, seedable demo, migration-based deploys (worktree `render.yaml` now uses `migrate deploy`, fixing the prior `db push` finding — but UNCOMMITTED).
- Gaps: **no distributed tracing, no alertmanager delivery** (metrics exist, nobody gets paged), **no tested RPO/RTO** (rehearsal script UNEXECUTED), `preDeploy: prisma db seed` is dangerous on repeat deploys (must be idempotent-gated), single-instance in-memory constructs (refresh single-flight, attempt counters) don't span replicas, local uploads don't survive container restarts (needs S3 in prod).

---

## 18. UX & Accessibility Audit (static + spec inventory)

- Bilingual bn-first UX, PWA installable, offline banner + queued-mutation toasts, per-page loading/empty/error patterns (spot-checked), ErrorBoundary + route titles + analytics per route.
- 7 Playwright specs incl. `a11y.spec.ts` (axe-core), `offline.spec.ts`, `admin-guard`, `english-mode`, farmer journey, splash — suite exists but was NOT executed in this audit (PARTIALLY VERIFIED).
- `visual-contract.spec.ts` deleted (only `.bak` + stale snapshots remain) — remove or restore (P4).
- Web lint: 34 warnings incl. `exhaustive-deps` in `MyOrders`/`Services` (P3 — stale-closure risk in loaders).

---

## 19. Testing & QA Assessment

- **API:** 19 suites / 125 tests / 1 skipped, all passing; journeys cover auth, farm, marketplace, services+procurement, weather+AI+disease, admin, payments integrity, withdrawals, RBAC fixes, tenant isolation, security matrix, observability, metrics, concurrency (1 PG-only skipped on SQLite), AI eval + retrieval regression, unit-core, misc hardening.
- **Web:** 4 suites / 91 tests passing (api retry semantics, offline queue, i18n, format).
- **Coverage (measured):** 75.28% stmts / 67.23% branch / 77.31% funcs — passes thresholds by 0.28 pp on statements. Zero-coverage: `payment/*` (incl. brand-new SSLCommerz verify), `storage/s3.ts`, `openai-compat.ts` (9%), `storage/index.ts` — i.e., **every external-integration adapter is untested**. Negative/boundary tests exist for auth/AI/payments; contract tests for API envelope exist implicitly via helpers.
- **SWE SOP verdict:** Arrange-Act-Assert discipline visible, hermetic SQLite test DB via migrations+seed, `fileParallelism:false` avoids flakes, CI gates quality+PG+E2E. Missing: mutation testing, flake dashboard, performance budgets in CI (lighthouse is manual-only), visual regression (deleted spec).

---

## 20. CI/CD & DevSecOps Assessment

9-job `ci.yml` (api-quality → api-postgres → web-quality → web-e2e → android-build → gitleaks → docker-build → trivy-scan → security-scan) + CodeQL + Dependabot + manual lighthouse/chromatic + release/debug APK workflows. Docker multi-stage images drop dev deps and prune aggressively; compose files for local/prod; `render.yaml` + `fly.toml` + `vercel.json` present. Gaps: audit/scan steps warn-only; e2e/lighthouse not blocking (by design, keep); staging deploy is SSH+manual-migration (document it as SOP, don't auto-migrate on boot — correct choice, keep); `preDeploy` seeding must be made idempotent; **11-file uncommitted drift means CI is testing older code than what I verified**.

---

## 21. Technical Debt (ranked)

1. Dual Prisma schemas (`schema.prisma` vs `schema.postgresql.prisma`) — drift risk; generate one from the other in CI and diff.
2. `strict:false` in API tsconfig — `no-explicit-any: error` mitigates, but strict null checks are off for financial code.
3. String-typed roles/statuses end-to-end — promote to PG enums + TS unions from Prisma.
4. Provider adapters at 0% coverage — exactly where money/security lives.
5. Local-upload + in-memory single-flight + no-Redis default — sticky single-instance assumptions.
6. Stale docs (`64 tests`, `79/79`, deployment/DR/UAT PARTIAL per prior audit) and dead files (`.bak`, snapshots, `tmp_fix_routes.mjs`, `pg-init.sql` 600-line legacy vs migrations).
7. 34 web lint warnings; exhaustive-deps in data loaders.
8. No pagination/cursor audit, no N+1 sweep, no API rate-limit headers surfacing.

---

## 22. Architecture Anti-Patterns (checked, mostly clean)

- God components/services: NOT found — routers are long but cohesive per domain; payment logic split into services/repository (excluded from coverage config as "Phase-3 scaffolds" — revisit that exclusion).
- Circular deps: none observed (`api.ts` uses lazy import for offlineQueue explicitly to avoid one — documented).
- Duplicated logic: session token truth was duplicated — **fixed in worktree** via `sessionManager`; verify no remaining direct `localStorage ab_at` readers (grep recommended).
- Magic values: provider names/env enumerated via zod — clean. Money in paisa integers (`money.ts`) — correct.
- Silent failures: telemetry `catch {}` blocks are deliberate + logged where user-visible; offline queue drops after budget with UI count — acceptable with disclosure.
- Insecure defaults: none that boot in prod (fail-fast verified). Dev defaults are weak but gitignored and documented.

---

## 23. Detailed Findings

| ID | Sev | Domain | Finding | Evidence | Impact | Recommendation | Effort |
|---|---|---|---|---|---|---|---|
| SEC-001 | P1 | Security | DB dumps with bcrypt hashes + phones committed to git | `apps/api/backup-*.json` tracked; 244 users, 283 token hashes (inspected keys + sample row) | Scanner failures, credential-harvest practice, history bloat | `git filter-repo` purge, rotate overlapping secrets, add `backup-*.json` to `.gitignore`, move rehearsal dumps to ignored `tmp/` | M |
| SEC-002 | P2 | Security | No ignore rules for `*.apk`, backups, root scripts, photo dirs | `git check-ignore` empty for APK/backups; ~50 MB + photos untracked in root | Accidental commit of binaries/secrets | Extend `.gitignore`, delete or relocate clutter | S |
| SEC-003 | P2 | DevSecOps | Audit gate warn-only; waiver expires 2026-09-30 | `ci.yml security-scan`, `SECURITY_WAIVERS.md` | Vulns merge silently after expiry | Make `npm audit` blocking for runtime deps; renew/replace waiver; pin toolchain bumps | S |
| OPS-001 | P1 | Reliability | `preDeploy` runs `prisma db seed` on every deploy | `render.yaml` (worktree) | Demo-data overwrite / duplicate-seed risk in prod | Gate seeding (`SEED_ON_DEPLOY=1` + idempotent seed) or remove from preDeploy | S |
| PAY-001 | P1 | Functional | No real money movement; SSLCommerz verify is new, uncommitted, 0%-covered | `sslcommerz.ts` diff (156 lines), coverage 0%, no creds | Cannot launch paid flows | Commit, unit-test with mocked fetch (VALID/INVALID/timeout), stage-verify with sandbox creds, keep sandbox-block | M |
| AI-001 | P1 | AI | KB has 7 entries — pilot-FAQ breadth only | `knowledge.ts` (224 lines, 7 entries) | Open-domain agronomy questions refuse (by design) or under-serve | Versioned KB expansion + eval set; disclose scope in product copy | M |
| AI-002 | P2 | AI | LLM path (`openai-compat`) 9% covered, no eval, no key | coverage table; `gateway.ts` fallback lines uncovered | First LLM enablement will fly blind | Pre-enablement checklist: cost model, eval suite, red-team prompts, PII scrub | M |
| DAT-001 | P2 | Data | Dual-schema maintenance; String roles; `Payment.userId` w/o relation (carried) | two schema files; `schema.prisma` reads | Drift, typo-able states, weak payment ownership | Generate-and-diff in CI; PG enums; add FK + backfill | M |
| ARCH-001 | P2 | Arch | `strict:false`; 11 files uncommitted incl. financial guards | `tsconfig.json`; `git status` | Type-safety gap; HEAD ≠ verified code | Commit reviewed drift now; enable `strict` incrementally (ledger paths first) | M |
| QA-001 | P2 | QA | Coverage on threshold (75.28 vs 75); adapters at 0% | measured `--coverage` | Regressions in money/security paths undetected | Raise to 80% with adapter tests (mocked fetch/fs/S3) | M |
| QA-002 | P3 | QA | Stale quality docs (64 / 79 claims vs 216 actual) | `README.md:68`, `PROJECT_STATUS.md` | Erodes trust in docs | Regenerate counts from CI artifacts | XS |
| OPS-002 | P2 | SRE | No tracing, no alert delivery, untested RPO/RTO | code + docs reads; rehearsal script unexecuted | Blind on-call, unproven recovery | OTel traces, alert rules with receiver test, quarterly restore drill with sign-off | M |
| PERF-001 | P3 | Perf | No load baseline; cold-start hosting; N+1 unswept | no k6/autocannon results; `loadtest.mjs` unexecuted | Launch-day surprises | Run `loadtest.mjs` vs staging, publish p50/p95, fix N+1s | S |
| UX-001 | P3 | UX | 34 web lint warnings; deleted visual spec leaves stale snapshots | `eslint` output; `e2e/` listing | Minor correctness/a11y drift | Fix exhaustive-deps, remove or restore visual spec | S |
| PRIV-001 | P2 | Privacy | No retention schedule; delete-cascade for advisory/audit rows unverified; placeholder contact | code + `SECURITY.md` reads | Compliance exposure pre-launch | Define retention matrix, verify anonymization, set real security contact | S |

Effort: XS <2h, S <1d, M 1–5d.

---

## 24. Risk Register

| Risk | Likelihood | Impact | Owner | Mitigation |
|---|---|---|---|---|
| Committed hashes abused/scanner block | M | H | Security | SEC-001 purge + rotation |
| Sandbox charged as real (operator confusion) | L | H | Product | Sandbox labelling verified; keep prod block + pre-launch gateway sign-off |
| LLM hallucination on enablement | M | H | AI | AI-002 checklist; keep offline default |
| Seed overwrites prod data | L | H | SRE | OPS-001 gating |
| Cold-start login failures on free tier | H | M | SRE | Paid hosting/warm-up; keep 30 s APK timeout |
| Wallet overdraft (HEAD code) | M | H | Backend | Commit worktree guards (already tested: 125 pass) |
| Untested adapters fail at launch | M | H | QA | QA-001 adapter tests |
| Outage without paging | M | M | SRE | OPS-002 alerts + drill |

---

## 25. Production Readiness Score

| Category | Weight | Score | Rationale |
|---|---|---|---|
| Architecture | 15% | **11.0** | Clean modular monolith, provider abstraction, RBAC, fail-fast env; minus dual-schema, `strict:false`, uncommitted drift |
| Functional Correctness | 15% | **11.0** | All core journeys executed green live + in suite; minus placeholder providers, unverified org depth |
| AI/LLM Quality | 15% | **10.0** | Honest grounded RAG-lite + eval/regression suites; minus 7-entry breadth, untested LLM path |
| Security | 15% | **10.0** | Strong auth/RBAC/hardening, zero secret-grep hits, clean runtime deps; minus SEC-001/002/003 |
| Testing/QA | 10% | **7.5** | 216 tests green, thresholds + PG + E2E in CI; minus threshold-margin coverage, 0% adapters, E2E not run here |
| Reliability/SRE | 10% | **6.5** | Health/ready/fallbacks/idempotency verified; minus tracing/alerts/RPO proof, seed-on-deploy |
| Performance/Scalability | 10% | **6.0** | Good bundle hygiene, new indexes (uncommitted); minus no baselines, cold-start hosting |
| UX/Accessibility | 5% | **3.5** | bn-first PWA + a11y specs; minus 34 lint warnings, no browser pass here |
| DevSecOps/CI-CD | 5% | **3.5** | 9-job pipeline + gates + multi-target deploys; minus warn-only scans, waiver expiry, drift |
| **Total** | 100% | **69.0/100** | |

---

## 26. Production Gate Decision

**⚠️ CONDITIONALLY READY — controlled pilot only. ❌ NOT ready for full production.**

Pilot-allowed conditions: PostgreSQL + `ALLOW_PLACEHOLDER_PROVIDERS=1` sign-off recorded, paid hosting (no cold-start tier), S3 uploads, `REDIS_URL` set, SEC-001 purged, worktree drift committed, seed removed from preDeploy, sandbox labelling retained, KB-scope disclosure in product copy, manual withdrawal review staffed.
Full-production blockers: real payment verification on live gateway, LLM path (or explicit KB-only product decision), alerting + restore-drill evidence, adapter coverage, retention schedule.

---

## 27. Prioritized Remediation Roadmap

### Phase 0 — Immediate (this week, P0/P1)
1. **Commit or revert the 11-file drift** — wallet guards, SSLCommerz verify, queue dedupe, session truth, indexes, `migrate deploy`. Tested code must equal shipped code. Acceptance: clean `git status`, CI green on HEAD. (S)
2. **SEC-001 purge** — filter-repo the 3 dumps, rotate overlapping secrets, ignore `backup-*.json`. Acceptance: `git ls-files | grep backup` empty incl. history scan. (M)
3. **OPS-001** — remove/gate `db seed` in preDeploy. Acceptance: repeat deploy is data-safe. (S)
4. **`.gitignore` hardening** — `*.apk`, photos, `tmp_*.mjs`, `*.db`, rehearsal outputs. Acceptance: `git status` shows only source. (XS)

### Phase 1 — Production stabilization (2–4 weeks)
- PAY-001: SSLCommerz mocked-failure-matrix tests + staging sandbox verification. DAT-001: FK/enum/schema-diff CI. QA-001: 80% coverage with adapter tests. PRIV-001: retention matrix + delete-cascade verification. PERF-001: staging load baseline published.

### Phase 2 — Architecture hardening
- Incremental `strict:true` (ledger/auth first), query-client migration completion (pages still use local `useEffect` loads per code comments), N+1 sweep, cursor pagination audit, remove dead files (`pg-init.sql` vs migrations, `.bak`, stale snapshots).

### Phase 3 — AI quality
- Versioned KB with freshness metadata + expanded eval set (target 100+ graded cases incl. adversarial), LLM-path pre-enablement checklist (cost model, PII scrub, red-team, human review loop for low-confidence), streaming only if UX-justified.

### Phase 4 — Scale
- Redis-backed limits everywhere, S3-only uploads in prod, worker split for payouts/notifications, CDN + image resizing, read-replica readiness, OTel + alerting + quarterly restore drill.

### Phase 5 — Enterprise evolution
- MFA/SSO, tenant-aware org isolation hardening, analytics warehouse, multi-region DR with measured RPO/RTO, external SOC2-type audit.

---

## 28. Recommended Target Architecture

Keep the modular monolith (it fits the team/scale); evolve: `API → (queue: payouts/notifications/AI jobs) → workers`; PG primary + replica; Redis (limits/cache/session-spill); S3 + CDN media; OTel → collector → dashboards + paging; versioned KB service with eval harness gating promotion; gateway provider with per-transaction reconciliation job (never trust synchronous verify alone); mobile via the same PWA bundle + Capacitor shell. No microservices before 100k MAU.

---

## 29. Acceptance Criteria (pilot → production)

- [ ] `git status` clean; HEAD == tested code; CI green incl. PG suite + E2E
- [ ] SEC-001/002/003 closed; waiver renewed or removed; runtime `npm audit` clean at high+
- [ ] Staging load report published (p50/p95, 15-min soak, cold-start excluded by tier)
- [ ] Payment sandbox matrix green; live-gateway decision recorded (go/no-go with evidence)
- [ ] Restore drill completed with measured RPO/RTO + sign-off
- [ ] Alerting tested end-to-end (fire a synthetic alert, page received)
- [ ] Retention matrix published; delete-cascade verified by test
- [ ] Docs regenerated (test counts, deployment, DR) — no stale numbers

---

## 30. Final CTO-Level Conclusion

**If AgroBridge were presented today to an enterprise CTO, government partner, or serious investor, would you approve it for production deployment?**

## Answer: CONDITIONAL (pilot YES with guardrails; full production NO)

1. Core platform genuinely works — verified by execution, not claims (216 tests green + live smoke).
2. Security fundamentals are solid (auth, RBAC, hardening, fail-fast boot) with no live secret leaks.
3. Financial paths are carefully designed (ledger, idempotency, sandbox labelling) and newly hardened — but the hardening is uncommitted.
4. AI is honest RAG-lite with real eval discipline — narrow (7 entries), correctly scoped, not oversold in code.
5. Committed DB dumps with password hashes must be purged before any external diligence.
6. Production today = placeholders (mock/offline/sandbox) — acceptable for pilot with written sign-off, not for launch.
7. No real-money, LLM, SMS, or S3 path is proven — each needs its own go-live checklist.
8. Operability is half-built: metrics without paging, backups without drill, deploys with seed risk.
9. Coverage sits on the threshold and every external adapter is untested — fix before money moves.
10. Team velocity and remediation discipline are visibly high (APK 1.3.0→1.3.7, prior-audit fixes in flight) — the trajectory supports a **6–8 week path to full production** if Phase 0–1 are executed in order.
