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
| Token storage (SEC-02 / FIX-08) | SEC-02 | **Executed 2026-11-22.** API: the refresh token also rides an HttpOnly cookie (`ab_rt`, SameSite=None+Partitioned+Secure in the cross-site production profile, Lax same-origin locally) with a CSRF double-submit pair (`ab_csrf` at path `/` so the client can read it on any document); body transport stays accepted for the Android migration window; logout/reset/deletion clear the cookies. Web: zero tokens in `localStorage` (legacy keys migrated at boot); both tokens mirror in per-tab `sessionStorage` — the access-token mirror exists so a reload restores WITHOUT hitting /auth/refresh, which keeps rapid navigations from racing a rotation into a reuse-detection family kill; refresh transports are body-first, cookie+CSRF when the mirror is empty (second tab, new tab) | `tests/auth-cookie-session.test.ts` (6 cases: flags, rotation, CSRF refusal without consumption, logout clearing), web `api.test.ts` (localStorage-free invariant, transport/CSRF/migration), e2e AUTH-01/AUTH-03 (second-tab cookie restore, tamper-surface removal), full chromium suite 84 passed / 2 skipped |
| MFA + step-up (SEC-04 / FIX-14) | SEC-04 | **Executed 2026-11-22.** TOTP enrolment for the ADMIN/SUPER_ADMIN tier (`/auth/totp/enroll|activate|disable`, RFC 6238 on `node:crypto`, opt-in per account — the seeded operators change nothing until they enrol; login demands the code only after the password proves possession). SMS step-up (`/auth/otp/stepup`, STEP_UP challenge purpose) now gates `POST /wallet/withdrawals` (consumed after the idempotency replay fast-path) and `DELETE /auth/me` — a stolen session can neither move money out nor erase an account without the phone. Schema: `User.totpSecret/totpEnabledAt` + the STEP_UP vocabulary, additive migrations in both chains. Web: login TOTP field, shared `StepUpAuth` widget on the deletion dialog and withdrawal form, administrator enrolment panel, 13 bilingual i18n keys | `tests/auth-totp-stepup.test.ts` (10 cases), the withdrawal/deletion suites updated to mint codes, response-contract probes the four new endpoints on a throwaway admin, chromium e2e 84 passed / 2 skipped with the gates live, CI e2e job opts into `DEV_AUTH_SHORTCUTS=1` for code echo |
| Tenant claim reword | ARC-07 | `docs/security.md` now states tenancy is farm-scoped only (orders/wallets/payments carry no tenant key; RLS deferred per ADR-0015/0020) | docs |

**Deliberately NOT changed** (documented decisions, verified correct):
- **PAY-04 withdrawal-hold idiom** (`heldPaisa + 0` no-op UPDATE then re-read): correct under both dialects and documented in place; the audit's own note is maintainability. Replaced naturally by the FIX-17 ledger redesign.
- **Advisory treatment suppression**: owner kept serve-with-warning (§2).
- **SEC-08 registration distinguishability**: accepted trade-off (neutral 200 vs 201) — documented here as the recorded decision; revisit only if enumeration becomes an observed abuse vector.
- **Service worker kill switch, no-Sentry-on-web, `.gitleaksignore` pins**: existing documented decisions untouched.

## 4. Ready-to-execute designs (next workstreams)

### 4.1 SEC-02 — token storage — EXECUTED 2026-11-22

Implemented as the row in §3 (fix table) and committed; the design below is retained as the record of intent. Residual, documented: (1) the per-tab `sessionStorage` mirror is script-readable within a tab as the cookie-hostile-browser fallback — the audit's "no token in localStorage" acceptance holds, and the exposure is one tab for one token TTL; (2) cross-tab/second-tab persistence depends on the session cookie — guaranteed in the same-origin Docker topology, partitioned-cookie in the cross-origin Vercel topology, and fallback-to-relogin on browsers that block third-party cookies (Safari); (3) Android keeps the body transport during the migration window — a Keystore-backed plugin (`@capacitor-community/secure-storage`) is the follow-up hardening and needs an approved dependency change.

### 4.2 SEC-04 — MFA / step-up — EXECUTED 2026-11-22 (see the §3 row)

Shipped scope: TOTP (RFC 6238, `node:crypto`, opt-in per ADMIN/SUPER_ADMIN account) and SMS step-up on withdrawals and account deletion. **Follow-ups, not gaps:** recovery codes for lost authenticators (a locked-out admin today needs the disable flow from a second enrolled admin or a DB-side reset — add a recovery-code flow before scaling the admin tier); dual control above a configurable paisa threshold (the audit's maker-checker extension) tracks with FIX-17's ledger work.

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
