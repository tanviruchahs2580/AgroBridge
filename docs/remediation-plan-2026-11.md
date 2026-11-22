# Remediation plan — November 2026 audit response

> Owner: engineering · Status: active · Source: "AgroBridge v1.4.3 — Full Technical Audit & Production-Readiness Report" (2026-11-21), every finding re-verified against the code before acting · Companion to `docs/STATUS.md` (live-vs-simulated truth) and `SECURITY_WAIVERS.md`.

## 1. What this document is

The external audit scored v1.4.3 **64/100 (pilot-grade)** against an enterprise production bar and projected ≈72 after P0, ≈82 after P1, ≈90 after P2. This plan records, in one place: what was verified and fixed in code (2026-11-22), what needs an owner decision or an external account, and the sequenced roadmap for the rest. It is the single source for remediation scope; `CHANGELOG.md` remains the release record and `docs/STATUS.md` the live/simulated tracker.

**Verification discipline:** the audit was a static sandbox review of a zip — nothing executed. Every P0 finding was re-confirmed at `file:line` in the repo before work started. Result: 12 confirmed, 1 partial (audit-log phone is normalized-but-unmasked), 0 refuted.

## 2. Owner decisions recorded (2026-11-22)

| Decision | Choice | Consequence / revisit trigger |
|---|---|---|
| Licence (CMP-03) | **Keep MIT for now** | Risk accepted while the repo is private and pre-scale. Revisit **before any public repo or external distribution**; if switched to proprietary, name the legal entity as copyright holder. |
| Advisory policy (FIX-11 / AIG-01) | **Keep serve-with-warning** | UNSOURCED entries keep contributing treatment/dosage content with the prominent unreviewed note + DAE-officer referral (the tested `unreviewedTreatmentRequired` behaviour). Closure of AIG-01 = agronomist sign-off of entries with real `sourceName`/`sourceUrl`/`reviewedAt`, tracked in §5. |
| Token storage (SEC-02) | **Dedicated follow-up workstream** | Design is ready in §4.1; execute as its own session with its own gates, not mixed with other changes. |
| Session output | **Uncommitted working tree** | Changes delivered for review; commit series on approval. |

## 3. Fixed in code (2026-11-22, v1.4.3 tree)

Each item below lists the finding it closes, the code change, and the test that pins it. All gates green after the change set (see the delivery receipt for exact commands and Node-version caveat).

| Fix | Finding | Change | Pinned by |
|---|---|---|---|
| Refresh limiter per token | SEC-01 (API) | New `refreshLimiter` keyed on the presented-token fingerprint (`rateLimitKeys.ts` `refreshKey`), replacing the IP-fallback `loginLimiter` on `/refresh`; new `REFRESH_RATE_LIMIT_MAX` (default 60/15min) | `tests/auth-refresh-limiter.test.ts` — 50 users on one address refresh 4× each with zero 429; a hammered token meets 429 + envelope |
| Client never logs out on transient refresh | SEC-01 (web) | `api.ts` refresh is outcome-aware: 429/5xx/network = "transient" → retryable `RATE_LIMITED` error, tokens and `unauthorizedHandler` untouched; only 400/401 clears the session | `api.test.ts` — 429 and 5xx keep the session; 401 still clears |
| Order deletion allow-list | PAY-06 | `DELETE /orders/:id` now deletes only `CANCELLED`/`REFUNDED`; `PAID` (and future `DELIVERED`) refuse with 422 until refunded. The web consumer landed in the same change: `MyOrders.tsx` `deletable()` mirrors the allow-list, so PAID orders no longer render an always-422 delete button; `api-types.ts` status comment lists `REFUNDED`. Note: the old journey test asserted "allows delete once paid" — that assertion codified the defect and was rewritten as a behaviour-spec correction | `tests/journey-marketplace.test.ts` (PAID blocked → refund → delete), `api.test.ts` (44→45 web cases), BR-10 updated; verified live in the browser (PAID button hidden; CANCELLED delete → confirm → success toast → 404) |
| Account deletion vs order lifecycle | CMP-01 | `DELETE /auth/me` blocks only in-flight orders (`PENDING`/`CONFIRMED`/`SHIPPED`); settled history proceeds through anonymisation. The never-written `DELETED` status reference is gone — any customer who ever paid can self-delete again (Play account-deletion requirement) | `tests/account-deletion-order-guard.test.ts` — one case per order status |
| Atomic OTP attempt cap | SEC-03a | `/otp/verify` and `/password/reset` consume an attempt with one conditional `updateMany` (`attempts < 5`) before comparing — parallel guesses can never exceed the cap | `tests/otp-attempt-race.test.ts` — 12 parallel wrong guesses → exactly 5 counted; correct code still wins on the 5th attempt |
| Normalized reset-limiter key | SEC-03b | `forgotLimiter`/`resetLimiter` key on `normalizeBdPhone(body.phone)`; unparseable strings collapse to one segment. Supersedes the raw-string keying (the comment documented the behaviour, but caller-controlled spelling diversity defeated the budget) | `tests/otp-attempt-race.test.ts` — 5 spellings share one budget; 6th request → 429 |
| OTP pepper domain separation | SEC-03c | `shared/utils/kdf.ts` (`deriveSubkey`, RFC 5869 HKDF) derives `otp-hash-v1` and `login-attempt-salt-v1` from `JWT_ACCESS_SECRET` — no new env var. **Deploy note:** in-flight OTP challenges and login-attempt counters invalidate once (users re-request a code; throttle counters reset) | `tests/otp-attempt-race.test.ts` (derivation unit) + all auth suites |
| Live-gateway public URL guard | SEC-05 | Production + `SSLCOMMERZ_SANDBOX=false` requires an https `API_PUBLIC_URL` or startup aborts (`liveGatewayPublicUrlProblem`); `.env.example` updated | `tests/payment-provider-truthfulness.test.ts` |
| Sandbox flag literal-union | PAY-07 | `SSLCOMMERZ_SANDBOX` parses only `"true"`/`"false"` — typos fail at startup instead of silently meaning sandbox | schema + `sslcommerzMode` tests unchanged and green |
| Webhook limiter exemption | PAY-03 | `/v1/payments/webhook/` exempt from the global per-address limiter; dedicated `webhookLimiter` (600/15min, own `payments-webhook` Redis namespace) bounds flood while real IPNs never 429 | `tests/payments-webhook-limiter.test.ts` — webhook answers past a global budget of 2 while non-webhook traffic 429s |
| Audit PII masking | SEC-10 | `AUTH_LOGIN_FAILED` phone and `EMAIL_CHANGED` address stored masked via new `shared/utils/mask.ts`; the two pre-existing parallel mask helpers (SMS logs, payout destination) now delegate to it | `tests/audit-pii-masking.test.ts` — masked present, raw absent |
| Status-vocabulary drift | DAT-01 (slice) | `Order.status` comment lists `REFUNDED` in all three schema files; `docs/business-rules.md` §3 + BR-10 and `docs/api.md` updated to the new deletion rule. Comment-only — no DDL, no migration. Real CHECK constraints stay with FIX-15 | ERD freshness gate green (comment-insensitive) |
| Tenant claim reword | ARC-07 | `docs/security.md` now states tenancy is farm-scoped only (orders/wallets/payments carry no tenant key; RLS deferred per ADR-0015/0020) | docs |

**Deliberately NOT changed** (documented decisions, verified correct):
- **PAY-04 withdrawal-hold idiom** (`heldPaisa + 0` no-op UPDATE then re-read): correct under both dialects and documented in place; the audit's own note is maintainability. Replaced naturally by the FIX-17 ledger redesign.
- **Advisory treatment suppression**: owner kept serve-with-warning (§2).
- **SEC-08 registration distinguishability**: accepted trade-off (neutral 200 vs 201) — documented here as the recorded decision; revisit only if enumeration becomes an observed abuse vector.
- **Service worker kill switch, no-Sentry-on-web, `.gitleaksignore` pins**: existing documented decisions untouched.

## 4. Ready-to-execute designs (next workstreams)

### 4.1 SEC-02 — token storage (the next dedicated session)

Goal: no token in `localStorage`; refresh token unreadable by scripts.

- **API:** keep the JSON body for the access token; set the refresh token as `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie on login/register/refresh; accept it from the cookie (or body for the Android transition window) on `/refresh` and `/logout`. Add a CSRF token (double-submit header, non-HttpOnly, checked on cookie-authenticated mutations) since SameSite alone is not the CSRF story for the Capacitor origin.
- **Web:** access token in memory only (`sessionManager` keeps cross-tab BroadcastChannel but stops persisting `ab_at`/`ab_rt`); on boot, no token → rely on the cookie: call `/auth/refresh` once at boot to mint an in-memory access token. The offline queue keeps its idempotency keys (`clientUuid`) so queued writes survive the change. 401-refresh semantics from the 2026-11-22 change (transient ≠ logout) carry over unchanged.
- **Android (Capacitor):** `@capacitor/preferences` is not sufficient for the refresh cookie across WebView restarts — use `@capacitor-community/secure-storage` (or Capacitor Cookies plugin) for a Keystore-backed refresh token; keep the body-transport compatibility flag during the migration window.
- **Migration/e2e:** dual-accept window (cookie OR body) so the APK and web deploy independently; update the Playwright login fixtures; add an e2e that asserts `document.cookie` never exposes a refresh token; update `docs/runtime-contract.md` and the api-contract fixture for the refreshed response shape.
- **Estimate:** 5–8 person-days including e2e; do NOT mix with other changes.

### 4.2 SEC-04 — MFA / step-up (P1)

TOTP (RFC 6238) for ADMIN/SUPER_ADMIN with `node:crypto` HMAC — no dependency needed; enrolment + recovery codes; step-up OTP for withdrawal approval and `DELETE /auth/me`; dual control above a configurable paisa threshold. Design the enrolment UX before coding (recovery-code custody is the risky part).

### 4.3 FIX-03 — SSLCommerz conformance (owner account + credentials required)

The current signature implementation hashes all posted parameters; every webhook test signs with that same function, so the suite proves self-consistency only. Runbook:
1. Capture **real sandbox IPN payloads** (full field sets, including `verify_key`) as committed fixtures.
2. Implement the documented algorithm — verify against the current SSLCommerz merchant documentation which fields `verify_key` names — behind the same constant-time comparison.
3. Add a server-to-server **Validation API call with `val_id`** inside the webhook before settling.
4. Replay recorded payloads as contract tests; then an end-to-end ৳10 sandbox charge → IPN → refund → reconciliation match; then live.
5. Resolve the dismissed CodeQL alert on `sslcommerzSignature` (waiver expires 2027-01-31) once the real algorithm is in.

### 4.4 Owner-action runbooks (external accounts; nothing to code locally first)

| Fix | Action | Notes |
|---|---|---|
| FIX-04 real SMS | Choose a BD gateway (full-number delivery on Grameenphone/Robi/Banglalink/Teletalk), set `SMS_PROVIDER=http` + `SMS_API_URL`/`SMS_API_KEY`, remove `ALLOW_PLACEHOLDER_PROVIDERS` from production | G1 gate |
| FIX-05 Redis | Provision Upstash/Redis, set `REDIS_URL` on the API; `/ready` must report `limiterStore: redis`; limiter wiring already namespaces every limiter | also fixes per-instance rate limits |
| FIX-09 region | **Database first**: move Neon to Singapore/Mumbai (new endpoint/project), verify from Dhaka; then pin the Vercel function region to the same region. Moving only the API makes latency worse — never reverse the order | G6 load test from a BD vantage point after |
| FIX-10 observability | Create a Sentry project (web + API + Android), add OTel/log sink, wire a paging destination (PagerDuty or a staffed Telegram/WhatsApp rota); synthetic checks for login/checkout/webhook | G5 gate; the web ErrorBoundary note says Sentry is the intended replacement |
| FIX-13 PITR | Upgrade Neon off the free tier, enable PITR, run `scripts/backup-restore-rehearsal.mjs` against a disposable DB, commit timed evidence; sign an RPO/RTO | G4 gate |
| FIX-12 licence ops | Recorded decision = keep MIT (§2); before public release, switch holder + licence per the revisit trigger | G9 gate |
| Vercel settings | Staging (`deploy-staging.yml`) needs `STAGING_HOST`/`STAGING_USER`/`STAGING_SSH_KEY`; never run before review — it has never executed | §11 approval boundary |

## 5. Sequenced roadmap (P1 → P2, adjusted for what is done)

**P1 — next 30–60 days (target ≈82):**
1. SEC-02 token storage (§4.1) — *before real money or real users at scale*.
2. FIX-15 PostgreSQL-only: retire the SQLite schema + chain; native enums/CHECK, `jsonb`, BigInt ledger money, typed FKs for `Payment.purposeId`/`WalletTransaction` (closes DAT-01/02/03/04 for real).
3. FIX-17 double-entry ledger + settlement reconciliation + maker-checker payouts (absorbs PAY-02/PAY-04).
4. FIX-18 outbox + workers for SMS/notifications/reconciliation (pg-boss or BullMQ; removes inline side-effects).
5. FIX-19 `packages/contracts`: Zod → OpenAPI 3.1 → generated TS client (ends `api-types.ts` hand-sync).
6. FIX-20 fulfilment module (order states beyond PAID, warehouse/field surfaces for the unused roles).
7. FIX-21 offline-first web (Workbox app shell + IndexedDB read cache + background sync; the service-worker kill switch stays until this replaces it deliberately).
8. FIX-22 auth hot-path cache with push revocation (Redis token-version set; keep hard DB check on money routes).
9. FIX-23 image pipeline (streaming multipart, re-encode through sharp, S3 pre-signed uploads).
10. FIX-24 OTel tracing + log aggregation + adopt the SLO doc with burn-rate alerts.
11. FIX-25/26 one deployment topology + IaC + a second maintainer with merge rights (bus factor).

**P2 — 60–120 days (target ≈90):** Python AI service (disease classifier → ONNX, pgvector RAG with multilingual Bangla embeddings, eval gates in CI) · Kotlin/Flutter decision from pilot KPIs (Compose + Room + WorkManager is the Android-first default) · tenant model + RLS decision (ARC-07 follow-through) · audit-log immutability/WORM (DAT-05) · external pentest + DPIA + BD regulatory mapping (CMP-04) · mutation testing/fuzzing on money+auth+parsers (TST-04) · partitioning/archival (DAT-07) · toolchain upgrades (ESLint 9 flat config everywhere, React 19, Tailwind 4, Express 5-or-Fastify — batched after the data-layer refactor, per the audit matrix).

**Stack verdict (unchanged by this plan):** keep TypeScript end-to-end; add Python only for AI/ML; no Go/Java/Rust rewrite, no microservice split, no GraphQL, no Kubernetes at this scale. The 704-case API suite is the asset — every roadmap item above preserves it.

## 6. Go-live gates (G1–G11, from the audit §8, with owners)

| Gate | Owner | Status |
|---|---|---|
| G1 real OTP end-to-end on all four operators | Owner + SMS vendor | open (FIX-04) |
| G2 live ৳10 charge → IPN verified → refund → reconciliation | Owner + engineering | open (FIX-03, §4.3) |
| G3 no open High/Critical finding; ZAP + external pentest clean | Owner + external | open (P2 pentest; this plan closes the code-local P0s) |
| G4 PITR restore within signed RTO | Owner | open (FIX-13) |
| G5 page fires ≤5 min after a killed DB in staging | Owner (needs FIX-10 paging sink) | open |
| G6 load test from a BD vantage meets p95 SLO | Engineering | open (needs FIX-09 region move first) |
| G7 deletion/export/consent pass for every order status | Engineering | **closed 2026-11-22** (per-status tests) |
| G8 agronomist sign-off on treatment-bearing entries | Owner + agronomist | open (FIX-11; warning policy keeps the app honest meanwhile) |
| G9 legal docs approved, domain live, licence decided | Owner | partially open (licence decision recorded; counsel review pending) |
| G10 secrets rotated after last contributor change | Owner | open (runbook exists) |
| G11 two-person review on money/auth paths | Owner | open (needs a second maintainer) |
