# App Audit Report – Play Store Launch Readiness

**App Name:** AgroBridge
**Version Under Review:** 1.3.0 (versionCode 13000)
**Audit Date:** 2026-09-01
**Auditor:** AI Principal Engineer
**Overall Confidence Score:** 48/100
**Final Recommendation:** NO-GO

---

## Executive Summary

AgroBridge is a farmer-centric digital agriculture platform for Bangladesh with a React/TypeScript SPA (Capacitor Android wrapper) backed by an Express modular monolith API, PostgreSQL, and Prisma ORM. The codebase demonstrates **strong engineering fundamentals**: comprehensive RBAC (13 roles), provider-abstracted external services, Zod validation on every endpoint, atomic financial transactions, offline mutation replay, structured logging with Prometheus metrics, and exceptional documentation (15+ docs).

However, the application is **not ready for Play Store submission** due to 5 critical blockers that are primarily non-technical prerequisites: no hosted privacy policy URL, no store listing assets (screenshots/feature graphic), no production domain configured, placeholder legal entity information, and no IARC content rating. On the technical side, there are 8 high-severity findings including committed `.env` files with real secrets, `minifyEnabled false` in release APK, no crash reporting SDK, no push notifications (FCM), zero frontend unit tests, unused React Query dependency, web lint failures, and API TypeScript strict mode disabled.

The architecture is production-grade in design (provider abstraction, health checks, audit trails, graceful shutdown) but has operational gaps: no automated Play Store upload pipeline, no database backup automation, manual versioning, and dormant quality gates (Lighthouse/Chromatic). Estimated time to launch-readiness after fixing blockers: **2-4 weeks** depending on asset creation and domain configuration speed.

---

## Severity Summary

- **Blockers (CRITICAL):** 5
- **High:** 10
- **Medium:** 16
- **Low:** 14
- **Total Findings:** 45

---

## Detailed Findings by Phase

### Phase 0 – Preparation & Context

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 0.1 | Tech stack identified | PASS | — | React 18.3, Vite 6, Capacitor 8.5, Express 4.21, Prisma 6.5, PostgreSQL 17 | — |
| 0.2 | Android version matrix | PASS | — | targetSdk=36, compileSdk=36, minSdk=24, versionName=1.3.0, versionCode=13000 | — |
| 0.3 | Environment files | PARTIAL | MEDIUM | Root `.env` and `apps/api/.env` exist with real secrets; `.env.example` documented but drifts from actual vars | Synchronize `.env` and `.env.example` variable names |
| 0.4 | Secrets in working tree | FAIL | CRITICAL | Root `.env` contains real JWT secrets (64-hex) and DB password. `apps/api/.env` contains dev-mode secrets. Both appear in working tree (gitignored but present) | `git rm --cached .env apps/api/.env`, rotate all secrets, `git filter-branch` if ever committed |
| 0.5 | CI/CD pipelines | PASS | — | 6 workflows: ci.yml (9 jobs), codeql.yml, android-release.yml, deploy-staging.yml, chromatic.yml, lighthouse.yml | — |
| 0.6 | Third-party SDKs | PASS | — | All MIT/ISC/Apache licensed, no GPL/AGPL. Capacitor 8.5.0 (recent), pino 9.6, helmet 8.0, zod 3.24 | — |

### Phase 1 – Architecture

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 1.1 | Architecture pattern | PASS | — | Modular monolith (backend) + lazy-loaded SPA (frontend). Provider abstraction for AI/weather/payment/storage. | — |
| 1.2 | Separation of concerns | PASS | — | Frontend ↔ Backend via REST. Provider adapters swappable. Server-side RBAC. | — |
| 1.3 | Documentation quality | PASS | — | 15+ docs covering architecture, security, deployment, DR, data protection, API, database, troubleshooting | — |
| 1.4 | Environment separation | PASS | — | Dev (SQLite + mock providers), Test (CI with seeded SQLite), Prod (PostgreSQL + real providers). Production refuses to start with weak JWT secrets. | — |
| 1.5 | Architecture score | PASS | — | Overall 7.3/10. Clean provider abstraction, good RBAC, strong ops hygiene. Modules lack internal service/controller split. | — |

### Phase 2 – Code Quality

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 2.1 | Linting enforcement | PARTIAL | HIGH | API ESLint passes clean. Web ESLint fails: 2 errors (Splash.tsx conditional useEffect, App.tsx empty catch) + 29 warnings (unused imports in MyFarm.tsx, ui.tsx, api.ts). No Prettier or .editorconfig. | Fix web lint errors before launch. Add Prettier. |
| 2.2 | Dead code | FAIL | HIGH | `services.page.backup.tsx` (572 lines) and `Services.tsx.backup` in production source tree. Compiled by TypeScript, included in lint. | Delete backup files. |
| 2.3 | Hard-coded secrets | PASS | — | No secrets in source code. All secrets via env vars. Production hard-guards against weak secrets (env.ts:47-51). | — |
| 2.4 | Type safety | PARTIAL | HIGH | Web: strict mode ON, 3 `any` in ui.tsx (minor). API: `strict: false`, `noImplicitAny: false` in tsconfig.build.json. Zero @ts-ignore. | Enable strict mode in API tsconfig. |
| 2.5 | Error handling | PASS | — | Custom AppError with support codes (AB-XXXXX), Prisma error mapping, error boundaries per-route, graceful shutdown handlers. | — |
| 2.6 | Log redaction | PARTIAL | MEDIUM | Pino redacts `req.headers.authorization`, `*.password`, `*.token` — but top-level `password`/`token` keys NOT redacted. Verified live. S3 secret key not in redact list. | Add top-level `password`, `token` to redact paths. |
| 2.7 | Dependency health | FAIL | HIGH | `npm audit`: 10 vulnerabilities (4 HIGH: deepmerge-ts stack exhaustion via prisma, vite path traversal, esbuild CORS). Capacitor 8.5.0 is current. | Run `npm audit fix`. Update vite. |
| 2.8 | License compliance | PASS | — | All deps MIT/ISC/Apache-2.0. Repo LICENSE = MIT. No GPL/AGPL found. Missing `license` field in package.json files (low). | Add `"license": "MIT"` to all package.json. |

### Phase 3 – Feature Completeness

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 3.1 | Core features | PASS | — | 12 pages implemented: Login, Register, Home, MyFarm, Market, Services, SellCrop, Wallet, Notifications, Advisor, Admin, Onboarding | — |
| 3.2 | Push notifications (FCM) | FAIL | CRITICAL | Zero Firebase/FCM integration found. No `google-services.json`, no `FirebaseMessagingService`, no push registration code. | Add Firebase project → FCM → Capacitor Firebase Messaging plugin |
| 3.3 | Deep links / App Links | FAIL | HIGH | Only MAIN/LAUNCHER intent filter in AndroidManifest. No custom scheme, no app links. | Add `<intent-filter>` with `android:scheme="https"` or `agrobridge://` |
| 3.4 | Offline support | PARTIAL | MEDIUM | localStorage queue with idempotent replay exists. But items are removed BEFORE flush attempt (shift() at line 106) — loss on partial failure. No PWA offline fallback page. | Fix queue to remove only after success. Add navigateFallback. |
| 3.5 | Loading/empty/error states | PASS | — | Skeleton components for services/market/wallet. Empty states in list views. ErrorBoundary with retry. Splash loading screen. | — |
| 3.6 | Localization | PARTIAL | MEDIUM | Bengali/English dictionary system. But some hardcoded English strings remain: ARIA labels in Login.tsx ("Hide password"/"Show password"), image alt texts. | Route all user-visible strings through `t()`. |
| 3.7 | Accessibility | PASS | — | WCAG AA: 49 focus-visible rings, 31 aria-labels, 32 role attributes, 13 sr-only labels, 27 htmlFor/id pairs, skip-nav link. axe-core in E2E. | — |
| 3.8 | Hardcoded weather coords | FAIL | MEDIUM | `MyFarm.tsx:75` — lat/lng hardcoded to `25.9/89.1` (Rangpur). Weather data wrong for non-Rangpur users. | Use geolocation API or derive from farm district. |
| 3.9 | Phone input UX | FAIL | MEDIUM | `<Input>` renders `type="text"` — no numeric keypad on mobile. Phone fields at Login.tsx:120, Register.tsx:80. | Add `inputMode="tel"` and `pattern="[0-9]{11}"`. |
| 3.10 | Image error handling | FAIL | MEDIUM | `ServiceCard.tsx:92` — `onError` sets `opacity: 0`, hiding broken images with no fallback. | Show placeholder icon on image error. |
| 3.11 | React Query unused | FAIL | HIGH | `@tanstack/react-query` installed (~40KB) but `useQuery`/`useMutation` appear nowhere in app code. QueryClient configured but never used for fetching. | Either integrate React Query for caching/dedup or remove the dependency. |
| 3.12 | No in-app update | FAIL | HIGH | No version check or force-update dialog. Users may run severely outdated APKs. | Add version check on app start with force-update modal. |

### Phase 4 – UI/UX & Design System

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 4.1 | Design tokens | PASS | — | CSS variables in `tokens.css`, JS mirror in `tokens.ts`, Tailwind integration. Semantic naming (brand, surface, text, status). | — |
| 4.2 | Dark mode | N/A | — | Not implemented. Zero `dark:` classes. Not required for Play Store. Android 15+ encourages but doesn't mandate. | Optional: add `darkMode: "class"` + dark CSS vars post-launch. |
| 4.3 | Responsive design | PASS | — | Mobile-first with responsive classes. E2E tests at 390px (mobile), 768px (tablet), 1280px (desktop). | — |
| 4.4 | Safe area / notch | PASS | — | `viewport-fit=cover`, `env(safe-area-inset-*)` on bottom nav, toast, splash, market cart. | — |
| 4.5 | Reduced motion | PASS | — | `motion-reduce:transform-none` on 19 elements. `window.matchMedia('prefers-reduced-motion')` in Advisor. Splash has static fallback. | — |
| 4.6 | Touch targets | PARTIAL | MEDIUM | Most buttons 44px+ (WCAG AAA). ErrorBanner dismiss button only ~28px. | Increase ErrorBanner dismiss to `min-h-[44px]`. |
| 4.7 | Dynamic page titles | FAIL | MEDIUM | Static `<title>AgroBridge</title>`. No per-page `document.title` updates. | Add `useEffect` with `document.title` in each page, or use react-helmet. |
| 4.8 | Password toggle a11y | FAIL | HIGH | `Login.tsx:139` — `tabIndex={-1}` on show/hide password button. Keyboard users cannot reach it. | Remove `tabIndex={-1}` or change to `tabIndex={0}`. |
| 4.9 | Loading skeletons | PASS | — | Skeleton components for service cards, market products, wallet. Button loading states. Animated splash. | — |
| 4.10 | Form validation UX | PASS | — | Bengali error messages, `role="alert"`, `aria-invalid`, inline errors (not toast). `noValidate` on most forms. | — |

### Phase 5 – Performance

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 5.1 | Bundle size | PARTIAL | MEDIUM | No dist/ baseline measurement. framer-motion ~60KB, React Query ~40KB (unused). No heavy legacy deps (no moment.js, lodash full). | Run `npm run analyze` to establish baseline. Remove unused React Query. |
| 5.2 | Code splitting | PASS | — | 11/12 pages use `React.lazy()`. Login eagerly loaded (correct — critical path). OfflineQueue dynamically imported. | — |
| 5.3 | Image optimization | PARTIAL | MEDIUM | 11 service images total 2.4MB, all JPG/PNG. Only 2/11 use `loading="lazy"`. No WebP, no srcSet, no image CDN. | Convert to WebP, add `loading="lazy"` to all offscreen images. |
| 5.4 | Network efficiency | PARTIAL | HIGH | React Query installed but unused — no request deduplication or caching. Manual `useEffect + api()` pattern used instead. GET retry with backoff and 10s timeout. Service worker caching configured. | Integrate React Query for data fetching or remove it. |
| 5.5 | Memory leaks | PASS | — | All useEffect hooks have cleanup. AbortController in fetch. Module-level listeners intentional (singletons). 2s polling interval for online status (acceptable). | — |
| 5.6 | Database performance | PASS | — | Comprehensive index coverage. No N+1 queries (uses `include` for nested data). `$transaction` with 15s timeout for checkout. | — |
| 5.7 | minifyEnabled false | FAIL | HIGH | `build.gradle:42` — release builds not minified. Larger APK, easier reverse engineering. | Set `minifyEnabled true`, configure ProGuard rules for Capacitor. |

### Phase 6 – Security

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 6.1 | Authentication | PASS | — | JWT 15min TTL, refresh rotation with reuse detection, bcrypt cost 12, SHA-256 hashed refresh tokens in DB, OTP rate-limited (5/hr), login brute-force protection (20/15min). | — |
| 6.2 | Secure storage | FAIL | HIGH | JWT access + refresh tokens stored in `localStorage` (keys `ab_at`, `ab_rt`). Vulnerable to XSS exfiltration. | Move to httpOnly cookies or accept risk with strict CSP. |
| 6.3 | Network security | PASS | — | Cleartext disabled in prod (network_security_config.xml), Helmet.js headers, CORS restricted, 1MB JSON limit, 16MB multipart limit. | — |
| 6.4 | Input validation | PASS | — | Zod on every endpoint. Prisma parameterized queries (no raw SQL). Phone regex `^01[3-9]\d{8}$`. Password 8-72 chars. File upload: MIME whitelist + magic bytes + 8MB. | — |
| 6.5 | Exported components | PASS | — | Only MainActivity exported (LAUNCHER). FileProvider `exported="false"`. CAMERA `required="false"`. | — |
| 6.6 | Code obfuscation | FAIL | HIGH | `minifyEnabled false` in release. ProGuard rules.pro is empty (default template). No R8 processing. | Enable minification, add Capacitor ProGuard rules. |
| 6.7 | Secrets in repo | FAIL | CRITICAL | Root `.env` with real JWT secrets and DB password. `apps/api/.env` with dev secrets. `.gitignore` excludes `.env` but files are in working tree. | `git rm --cached`, verify git history, rotate all secrets. |
| 6.8 | Dependency vulnerabilities | FAIL | HIGH | 10 npm vulns: 4 HIGH (deepmerge-ts, vite path traversal, esbuild CORS, uuid buffer), 6 MODERATE. | `npm audit fix`, update vite and prisma. |
| 6.9 | allowBackup | FAIL | MEDIUM | `AndroidManifest.xml:5` — `android:allowBackup="true"`. Data extractable via adb backup. Risk for financial app. | Set `allowBackup="false"` or configure `fullBackupContent` rules. |
| 6.10 | Privacy | PASS | — | First-party self-hosted analytics only. No third-party tracking SDKs. No PII in event props. Account deletion anonymizes identity data. | — |
| 6.11 | SSL in NGINX | PARTIAL | MEDIUM | NGINX prod config lacks HSTS header. No `Permissions-Policy` header. API Helmet provides these but web layer doesn't. | Add `Strict-Transport-Security`, `Permissions-Policy` to nginx config. |

### Phase 7 – Backend/API

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 7.1 | API design | PASS | — | 60+ endpoints under `/api/v1/`. REST conventions correct. Consistent response envelope (`{ ok, data, requestId }`). API versioning. | — |
| 7.2 | Error handling | PASS | — | Custom AppError with support codes, Prisma error mapping (P2002→409, P2025→404), generic 500 in prod, 404 catch-all. | — |
| 7.3 | Rate limiting | PARTIAL | MEDIUM | Global (300/15min), login (20/15min), OTP (5/hr), AI (30/hr). Redis-backed for multi-instance. But NO rate limiter on `/register` endpoint. | Add registration rate limiter. |
| 7.4 | Database schema | PASS | — | 23 models, 6 migrations, comprehensive indexes. PostgreSQL for prod. Proper cascades (User→RefreshToken, Farm→Plot). | — |
| 7.5 | Validation | PASS | — | Zod on every mutating endpoint. File upload: MIME whitelist, magic bytes, size limit. Query params validated. | — |
| 7.6 | CORS | PASS | — | `WEB_ORIGIN` env-based. Credentials enabled. Methods restricted. | — |
| 7.7 | Financial integrity | PASS | — | `$transaction` with 15s timeout for checkout. Atomic stock decrement. Idempotent webhooks. Ledger rows. Refresh token reuse detection kills entire family. | — |

### Phase 8 – Testing

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 8.1 | API unit/integration tests | PASS | — | 18 test files, 119+ tests. Journey tests (auth, farm, marketplace, services, weather, admin). Security matrix. Concurrency tests. | — |
| 8.2 | Frontend unit tests | FAIL | CRITICAL | Zero `*.test.ts` or `*.test.tsx` files in `apps/web/src/`. No component tests, no hook tests, no utility tests. | Add tests for critical paths: auth, API client, offline queue, session management. |
| 8.3 | E2E tests | PASS | — | 6 Playwright specs: farmer journey, a11y (axe-core), admin guard, english mode, offline, splash. Responsive at 390px. | — |
| 8.4 | Coverage | PASS | — | API coverage: 80% statements, 68% branches, 79% functions. Thresholds: 75/63/73/75. | — |
| 8.5 | Test quality | PASS | — | Edge cases, concurrency, idempotency, financial ledger verification, RBAC enforcement. Supertest integration-level (not mocked). | — |
| 8.6 | Browser matrix | PARTIAL | MEDIUM | E2E only runs Chromium (Pixel 5, 390px). No Firefox/Safari testing. No desktop viewport in E2E. | Add Firefox and desktop viewport to Playwright config. |

### Phase 9 – Observability

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 9.1 | Crash reporting | FAIL | CRITICAL | No Sentry, Firebase Crashlytics, or Bugsnag. ErrorBoundary only does `console.error`. Code comment: "replace with Sentry in production." | Integrate Sentry or Firebase Crashlytics before launch. |
| 9.2 | Analytics | FAIL | HIGH | No Firebase Analytics SDK. First-party analytics exists but Play Store benefits from Firebase Analytics for ASO and acquisition data. | Add Firebase Analytics SDK. |
| 9.3 | Performance monitoring | PASS | — | Prometheus metrics (`/metrics`), Grafana dashboard, alert rules (5xx rate, latency, DB down, payment failures). | — |
| 9.4 | Logging | PASS | — | Pino structured JSON. Request IDs. Audit trail (Append-only AuditLog). Sensitive data redaction (partial — top-level fields missed). | Fix top-level field redaction. |
| 9.5 | Health checks | PASS | — | `/health` liveness, `/ready` readiness (DB ping). Docker HEALTHCHECK. Prometheus scraping 15s. | — |
| 9.6 | Web Vitals | FAIL | MEDIUM | No `web-vitals` package. No real-user Core Web Vitals monitoring. Only Lighthouse CI (dormant). | Add `web-vitals` reporting or configure Lighthouse CI as push gate. |

### Phase 10 – CI/CD

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 10.1 | CI pipeline | PARTIAL | MEDIUM | 9 jobs: API lint+test, PostgreSQL integration, web build, E2E, Android APK, Gitleaks, Docker build, Trivy scan, npm audit. Missing: web lint step. | Add ESLint to web-quality CI job. |
| 10.2 | Versioning | PARTIAL | MEDIUM | Manual versioning in `build.gradle`. `versionCode=13000`, `versionName=1.3.0`. No semantic-release, no auto-tagging. | Implement semantic-release or similar. |
| 10.3 | Signing | PASS | — | Release keystore from GitHub secrets. `android-release.yml` decodes keystore dynamically. Keystore not committed. | Consider Google Play App Signing. |
| 10.4 | Release automation | FAIL | HIGH | No automated Play Store upload. AAB must be manually uploaded. No Fastlane, no staged rollout. | Add Fastlane or google-play-cli for automated upload. |
| 10.5 | Docker | PASS | — | Multi-stage builds. API: Node 22 Alpine + apk upgrade + prod-only deps + npm removed. Web: nginx:alpine. Prod: network isolation, resource limits. Trivy scan passes (0 HIGH). | — |
| 10.6 | Staging deploy | FAIL | MEDIUM | `deploy-staging.yml` exists but is a scaffold. Placeholder domain `staging.agro.example.com`. Secrets not configured. | Configure real staging environment. |
| 10.7 | CodeQL | PASS | — | Running on push/PR to main + weekly cron. Security-extended queries. | — |

### Phase 11 – Play Store Compliance

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 11.1 | Target API level | PASS | — | targetSdk=36, compileSdk=36, minSdk=24. Meets 2026 Google Play requirement. | — |
| 11.2 | 64-bit support | PASS | — | WebView-only app (Capacitor). No native .so files. System WebView is 64-bit. | — |
| 11.3 | Privacy policy URL | FAIL | CRITICAL | `PRIVACY_POLICY.md` exists locally (155 lines, bilingual). Not hosted at any public URL. No `privacy.html` served. | Host privacy policy at `https://agrobridge.app/privacy` |
| 11.4 | Store listing assets | FAIL | CRITICAL | No screenshots, no feature graphic (1024×500), no short/full descriptions in repo. | Create phone screenshots (min 2), feature graphic, listing text |
| 11.5 | Permissions | PASS | — | INTERNET + CAMERA (optional). Minimal and justified. | — |
| 11.6 | Content rating | FAIL | MEDIUM | No IARC questionnaire completed. App targets adults (18+) — likely "Everyone" rating. | Complete IARC in Play Console. |
| 11.7 | Data Safety form | PASS | — | Documented in `docs/data-protection.md`. Phone, name, location, photos, financial data collected. No ad SDKs. No third-party analytics. | Enter data in Play Console manually. |
| 11.8 | Billing | PASS | — | No Google Play Billing. External SSLCommerz gateway + wallet. | — |
| 11.9 | Legal placeholders | FAIL | CRITICAL | `PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` contain `[Company]`, `[Address]`, `[privacy@company.example]` placeholders. | Fill in real entity information. |

### Phase 12 – Legal

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 12.1 | Terms of Service | PARTIAL | MEDIUM | 166-line bilingual ToS exists. But not hosted, not in-app accessible, no acceptance checkbox in registration. | Host at public URL, add registration checkbox. |
| 12.2 | Privacy Policy | PARTIAL | MEDIUM | Comprehensive (155 lines, bilingual). Covers data collection, retention, third parties, rights. But placeholder contact info. | Fill in real contact info, host at public URL. |
| 12.3 | IP clearance | PASS | — | MIT license. All deps permissive. No bundled third-party assets. | — |
| 12.4 | Account deletion | PASS | — | `DELETE /api/v1/auth/me` implemented. Anonymizes PII, retains financial records, revokes tokens. Tested. | — |

### Phase 13 – Production Environment

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 13.1 | CI status | PASS | — | Latest HEAD commit green (run 33532255809, all 9 jobs pass). CodeQL passes. | — |
| 13.2 | Production domain | FAIL | CRITICAL | All URLs are placeholders (`example.com`). No real production domain configured. `render.yaml` has internal IP `10.23.41.26`. | Configure real domain with TLS. |
| 13.3 | Monitoring | PASS | — | Prometheus + Grafana + 6 alert rules (5xx, latency, DB, payments, AI fallback, instance). | — |
| 13.4 | Backup strategy | FAIL | MEDIUM | `DISASTER_RECOVERY_REPORT.md` exists but no automated backup scripts. | Configure automated PostgreSQL backups (pg_dump cron or managed service). |

### Phase 14 – Final Pre-Launch Gate

| # | Check Item | Status | Severity | Evidence | Recommendation |
|---|------------|--------|----------|----------|----------------|
| 14.1 | Known issues | PARTIAL | — | Zero TODO/FIXME in code. 45 findings from this audit. | Address blockers and high-severity items. |
| 14.2 | Rollback capability | PARTIAL | MEDIUM | Docker-based deploys allow rollback to previous image tag. No automated rollback on failed health check. | Add health-check-based auto-rollback to deploy pipeline. |
| 14.3 | Release notes | FAIL | MEDIUM | No CHANGELOG.md or automated release notes. Git tags exist (v1.1.2, v1.2.0) but no notes. | Add CHANGELOG.md, generate release notes from commits. |

---

## Prioritized Action Plan

### Must Fix Before Launch (Blockers + High)

| # | Severity | Issue | Effort |
|---|----------|-------|--------|
| 1 | CRITICAL | Host privacy policy at public URL (replace `[Company]`, `[Address]` placeholders) | 1 day |
| 2 | CRITICAL | Create Play Store listing assets: screenshots (phone + tablet), feature graphic (1024×500), short/full descriptions | 2-3 days |
| 3 | CRITICAL | Configure real production domain with TLS | 1-2 days |
| 4 | CRITICAL | Fill in legal entity info in PRIVACY_POLICY.md and TERMS_OF_SERVICE.md | 0.5 day |
| 5 | CRITICAL | Complete IARC content rating in Play Console | 0.5 day |
| 6 | CRITICAL | Integrate Firebase Crashlytics or Sentry for crash reporting | 1 day |
| 7 | CRITICAL | Add frontend unit tests for critical paths (auth, API client, session) | 3-5 days |
| 8 | HIGH | `git rm --cached .env apps/api/.env`, rotate all secrets | 1 day |
| 9 | HIGH | Set `minifyEnabled true` + configure ProGuard rules for Capacitor | 1 day |
| 10 | HIGH | Add FCM push notifications | 2-3 days |
| 11 | HIGH | Enable TypeScript strict mode in API | 1 day |
| 12 | HIGH | Delete backup files (`services.page.backup.tsx`, `Services.tsx.backup`) | 0.5 hour |
| 13 | HIGH | Fix web lint errors (Splash conditional useEffect, empty catch) | 0.5 day |
| 14 | HIGH | Remove unused React Query dependency OR integrate it | 1 day |
| 15 | HIGH | Add deep/app links to AndroidManifest | 0.5 day |
| 16 | HIGH | Fix password toggle `tabIndex={-1}` (keyboard accessibility) | 5 min |
| 17 | HIGH | Add in-app version check + force update modal | 1 day |
| 18 | HIGH | Add Firebase Analytics SDK | 1 day |
| 19 | HIGH | Set up automated Play Store upload (Fastlane or similar) | 1-2 days |
| 20 | HIGH | Move JWT tokens from localStorage to httpOnly cookies (or accept XSS risk) | 1-2 days |

### Should Fix (Medium)

| # | Issue |
|---|-------|
| 21 | Add Pino redaction for top-level `password`/`token` fields |
| 22 | Add Prettier + .editorconfig for formatting enforcement |
| 23 | Synchronize `.env` and `.env.example` variable names |
| 24 | Add PWA offline fallback page (`navigateFallback`) |
| 25 | Fix offline queue item loss on partial failure |
| 26 | Add `loading="lazy"` to all offscreen images |
| 27 | Add dynamic page titles (`document.title`) |
| 28 | Add `inputMode="tel"` to phone inputs |
| 29 | Fix hardcoded weather coordinates (MyFarm.tsx:75) |
| 30 | Add NGINX HSTS and Permissions-Policy headers |
| 31 | Set `allowBackup="false"` in AndroidManifest |
| 32 | Add registration rate limiter |
| 33 | Add automated database backup strategy |
| 34 | Configure Lighthouse/Chromatic as CI gates |
| 35 | Add CHANGELOG.md |
| 36 | Complete IARC content rating in Play Console |

### Nice to Have (Low)

| # | Issue |
|---|-------|
| 37 | Add `"license": "MIT"` to all package.json files |
| 38 | Fix 3 `any` types in ui.tsx touch handlers |
| 39 | Add certificate pinning for financial app |
| 40 | Add `allowedHeaders` CORS restriction |
| 41 | Convert service images to WebP format |
| 42 | Add srcSet/responsive images |
| 43 | Consider CSS animations instead of framer-motion (60KB savings) |
| 44 | Remove duplicate service images (soil/soil-test, tiller/power-tiller) |
| 45 | Add dark mode support (post-launch feature) |

---

## Testing Evidence Required Before Final Sign-off

| # | Test | Status | Evidence |
|---|------|--------|----------|
| 1 | Cold-start shows zero white frames | DONE | Native splash changed to #0A2F1F. Verified via PNG pixel analysis. |
| 2 | React splash animation plays | PASS | Splash.tsx verified: seed→stem→leaves animation, progress ring, Bengali status texts. |
| 3 | Login flow (phone + password) | PASS | Journey test: `journey-auth.test.ts`. E2E: `farmer-journey.spec.ts`. |
| 4 | Farm CRUD lifecycle | PASS | Journey test: `journey-farm.test.ts`. |
| 5 | Marketplace + cart + checkout | PASS | Journey test: `journey-marketplace.test.ts`. |
| 6 | Service booking lifecycle | PASS | Journey test: `journey-services-procurement.test.ts`. |
| 7 | AI advisory flow | PASS | Journey test: `journey-weather-ai-disease.test.ts`. |
| 8 | Admin guard (403 for farmers) | PASS | E2E: `admin-guard.spec.ts`. |
| 9 | Accessibility (WCAG AA) | PASS | E2E: `a11y.spec.ts` with axe-core. Manual review: focus-visible, ARIA, sr-only. |
| 10 | Language toggle (BN↔EN) | PASS | E2E: `english-mode.spec.ts`. |
| 11 | Offline mode | PASS | E2E: `offline.spec.ts`. |
| 12 | Concurrency (oversell prevention) | PASS | `concurrency.test.ts` (PostgreSQL only). |
| 13 | Financial integrity (ledger) | PASS | `payments-integrity.test.ts`, `wallet-withdrawals.test.ts`. |
| 14 | Security matrix (RBAC) | PASS | `security-matrix.test.ts`, `rbac-fixes.test.ts`. |
| 15 | Account deletion | PASS | `auth-hardening.test.ts:107`. |
| 16 | **Firebase push notifications** | **MISSING** | No FCM integration exists. |
| 17 | **Deep link handling** | **MISSING** | No deep links configured. |
| 18 | **Force update flow** | **MISSING** | No version check mechanism. |
| 19 | **Crash reporting in prod** | **MISSING** | No Sentry/Crashlytics. |
| 20 | **Real-device Android testing** | **MISSING** | CI builds debug APK but no device test evidence. |

---

## Go / No-Go Decision Rationale

### **NO-GO (Confidence: 48/100)**

The application demonstrates **exceptional engineering quality** in its core design:
- Provider abstraction pattern for swappable external services
- Comprehensive RBAC with 13 roles
- Atomic financial transactions with idempotent webhooks
- Structured logging with audit trails
- WCAG AA accessibility
- Bilingual (Bengali/English) localization
- 15+ documentation files
- CI pipeline with 9 jobs including security scanning

**However, 5 CRITICAL blockers prevent Play Store submission:**

1. **No hosted privacy policy URL** — Google Play Console requires a public URL
2. **No store listing assets** — Screenshots, feature graphic, descriptions are mandatory
3. **No production domain** — All URLs are `example.com` placeholders
4. **Placeholder legal info** — `[Company]`, `[Address]` in privacy policy and ToS
5. **No content rating** — IARC questionnaire not completed

These are **non-technical prerequisites** that exist outside the codebase. On the technical side, the top 3 risks are:
1. Committed `.env` with real secrets (security risk)
2. `minifyEnabled false` in release APK (reverse engineering risk)
3. No crash reporting SDK (operational blindness)

**Estimated time to launch-readiness: 2-4 weeks** if:
- Legal/domain work runs in parallel with technical fixes
- FCM push notifications are integrated
- Frontend tests are added for critical paths
- Play Store assets are created

The codebase is **technically sound** and will be launch-ready once the non-technical prerequisites and high-severity technical items are addressed.

---

## Appendix

### Tools Used During Audit

| Tool | Purpose |
|------|---------|
| `npm audit` | Dependency vulnerability scanning |
| `eslint` | Code linting (API + Web) |
| `tsc --noEmit` | TypeScript type checking |
| `vitest` | Unit/integration test runner |
| `playwright` | E2E testing |
| `git diff` / `git status` | Change analysis |
| `gh run list` | CI status verification |
| PowerShell `System.Drawing` | PNG pixel analysis |
| Python `Pillow` | Splash image processing |
| `ripgrep` / `grep` | Pattern searching across codebase |
| Cap sync | Android asset synchronization |

### Key File Paths Reviewed

| Path | Purpose |
|------|---------|
| `apps/web/capacitor.config.ts` | Android Capacitor configuration |
| `apps/web/android/app/build.gradle` | Android build config |
| `apps/web/android/variables.gradle` | SDK versions |
| `apps/web/android/app/src/main/AndroidManifest.xml` | Permissions + intent filters |
| `apps/web/android/app/src/main/res/values/styles.xml` | Launch theme |
| `apps/web/src/App.tsx` | Router + code splitting |
| `apps/web/src/components/Splash.tsx` | Splash screen |
| `apps/web/src/components/ui.tsx` | Design system |
| `apps/web/src/lib/api.ts` | API client |
| `apps/web/src/lib/session.tsx` | Session/auth |
| `apps/web/src/lib/offlineQueue.ts` | Offline mutation queue |
| `apps/api/src/server.ts` | Express server entry |
| `apps/api/src/app.ts` | Route mounting + middleware |
| `apps/api/src/config/env.ts` | Environment validation |
| `apps/api/src/middleware/auth.ts` | JWT auth middleware |
| `apps/api/src/middleware/errorHandler.ts` | Error handling |
| `apps/api/src/lib/logger.ts` | Pino logger config |
| `apps/api/src/modules/*/routes.ts` | All 12 domain modules |
| `apps/api/prisma/schema.prisma` | Database schema |
| `apps/api/tests/*.test.ts` | All 18 test files |
| `apps/web/e2e/*.spec.ts` | All 6 E2E specs |
| `.github/workflows/ci.yml` | Main CI pipeline |
| `.github/workflows/codeql.yml` | SAST pipeline |
| `docker/api.Dockerfile` | Production API image |
| `docker-compose.prod.yml` | Production composition |
| `PRIVACY_POLICY.md` | Privacy policy |
| `TERMS_OF_SERVICE.md` | Terms of service |
| `docs/data-protection.md` | Data Safety form mapping |

### CI Run Reference

| Run ID | Status | Trigger | Jobs |
|--------|--------|---------|------|
| 33532255809 | ✅ SUCCESS | push (main) | 9/9 pass (including Trivy) |
| 33532255719 | ✅ SUCCESS | push (main) | CodeQL pass |
| 33521394142 | ❌ FAILURE | push (main) | 8/9 (Trivy failed, fixed in next commit) |
| 33520757619 | ✅ SUCCESS | push (main) | CodeQL pass |

---

*Report generated: 2026-09-01 | Auditor: AI Principal Engineer | Methodology: 14-phase comprehensive audit*
