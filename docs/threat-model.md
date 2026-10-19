# Threat model

Scope: the containers and data flows in `docs/architecture.md` — the static SPA on the Vercel edge,
the API function (Express modular monolith) on Vercel Functions, PostgreSQL on Neon, the
rate-limit store, provider adapters, and the Android WebView shell. Threats are enumerated with
STRIDE per container/flow; every control names its code location and, where one exists, the test
that pins it. Where no test exists this file says so rather than implying coverage.

Test paths below are relative to the repository root. No risk ranking is used beyond
"risk" (what the abuse achieves) and "residual" (what remains after the control).

## Container / flow inventory

| # | Container or flow | Trust boundary crossing |
|---|---|---|
| F1 | Browser or Android WebView → HTTPS API | Untrusted client input into the API pipeline |
| F2 | API → PostgreSQL (Neon) | Application queries against tenant data |
| F3 | API → provider APIs (OpenWeather, OpenAI-compatible, SSLCommerz, SMS, S3) | Outbound calls carrying user data or credentials |
| F4 | Gateway → `POST /api/v1/payments/webhook/sslcommerz` | Unauthenticated inbound webhook |
| F5 | SPA bundle served from the edge | Static content integrity and headers |
| F6 | Offline queue (localStorage) → API replay | Delayed, replayed, possibly stale writes |
| F7 | AI knowledge base → provider prompt → farmer-visible answer | Untrusted text into a model |

## Abuse cases

| ID | Abuse case | STRIDE | Flow | Risk | Existing control (evidence) | Test that pins it | Residual |
|---|---|---|---|---|---|---|---|
| AC-01 | Credential stuffing against `POST /auth/login` | Spoofing | F1 | Account takeover | Per-IP login limiter 20 per 15 min (`apps/api/src/modules/auth/routes.ts:34-45`); bcrypt cost 12 (`apps/api/src/modules/auth/routes.ts:141`); uniform 401 plus dummy-hash comparison to equalise timing (`apps/api/src/modules/auth/routes.ts:172-179`) | `apps/api/tests/login-timing-equalisation.test.ts:13,34`; `apps/api/tests/auth-rate-limit-envelope.test.ts:12` | Limiter is per instance without `REDIS_URL` (`apps/api/src/app.ts:26-39`); production currently reports `limiterStore: "memory"` (`.audit/v2/BASELINE.md`, live `/ready` probe) |
| AC-02 | Stolen refresh token replayed after rotation | Spoofing | F1 | Persistent session hijack | Tokens stored hashed (`apps/api/src/modules/auth/routes.ts:119-126`); rotation is a claim-atomic revoke, and a replay revokes the whole family (`apps/api/src/modules/auth/routes.ts:206-218`); logout revokes the presented token (`:230-241`) | `apps/api/tests/auth-hardening.test.ts:7,38`; `apps/api/tests/security-matrix.test.ts:65` | Tokens live in `localStorage` by accepted ADR-0003, so script execution in the SPA origin is equivalent to token theft |
| AC-03 | OTP brute force or SMS pumping on the verification flow | Spoofing / DoS | F1 | Phone takeover, SMS cost abuse | OTP request limiter 5 per hour; verify limiter 20 per hour keyed by user (`apps/api/src/modules/auth/routes.ts:46-93`); challenge TTL 5 min, max 5 attempts, a new code invalidates the old (`apps/api/src/modules/auth/routes.ts:313-314,330-380`) | `apps/api/tests/auth-hardening.test.ts:48,86` | `SMS_PROVIDER=sandbox` does not deliver in production (OD-15), so phone verification is not reachable for real users today |
| AC-04 | IDOR/BOLA: reading or mutating another user's order, booking, payment, notification, disease case, or advisory | Information disclosure / Elevation | F2 | Cross-user data access | Ownership is part of every lookup scope, and misses return 404 without an existence oracle (`apps/api/src/modules/marketplace/routes.ts:190-206`; `apps/api/src/modules/payments/routes.ts:265,286`; `apps/api/src/modules/aiagent/routes.ts:155-165`) | `apps/api/tests/cross-user-negative.test.ts:12,36,55,65`; `apps/api/tests/security-matrix.test.ts:11`; `apps/api/tests/farm-event-sync-scoping.test.ts:11,48` | New routes must keep the same scoping convention; there is no schema-level (RLS) backstop (OD-05) |
| AC-05 | Privilege escalation via profile update or admin-only routes | Elevation | F1, F2 | Role takeover | Permissions derive from a server-side map (`apps/api/src/middleware/rbac.ts:8-31`); role is re-read from the DB on every authenticated request (`apps/api/src/middleware/auth.ts:34-42`); profile schema has no `role` field (`apps/api/src/modules/auth/routes.ts:270-288`); farm `organizationId` reparenting is ignored (pinned by `apps/api/tests/rbac-fixes.test.ts:89`) | `apps/api/tests/security-matrix.test.ts:45,95`; `apps/api/tests/rbac-fixes.test.ts:7,89` | No test asserts every admin route individually; the matrix test samples the boundary |
| AC-06 | Tenant leakage between organizations | Information disclosure | F2 | Cross-tenant farm data exposure | Farms carry `organizationId`; access joins `OrganizationMember` (`apps/api/src/modules/organizations/routes.ts:115`) and CORPORATE/COOPERATIVE farm reads are scoped (`apps/api/src/modules/farms/routes.ts`) | `apps/api/tests/tenant-isolation.test.ts:6,34` | RLS is not enabled at the database level (OD-05), so a scoping bug in a new query would not be caught by the schema |
| AC-07 | Double payout or double withdrawal from the wallet | Tampering | F2 | Money duplication | Payout transitions `COLLECTED → PAID` as an atomic claim before crediting (`apps/api/src/modules/payments/routes.ts:484-490`); withdrawal availability is re-read under the wallet row lock and held in `heldPaisa` (`apps/api/src/modules/payments/routes.ts:632-662`); approve/reject are single-claim transitions (`apps/api/src/modules/admin/routes.ts:221-290`) | `apps/api/tests/concurrency.test.ts:53`; `apps/api/tests/withdrawal-race.test.ts:28,50,72,99`; `apps/api/tests/wallet-withdrawals.test.ts:116,134` | SQLite has no row locks; the serialisation guarantee is exercised on the PostgreSQL profile (`apps/api/tests/withdrawal-race.test.ts` notes the lock semantics) |
| AC-08 | Forged or replayed payment webhook | Spoofing / Tampering / Repudiation | F4 | Free goods, double side effects | MD5 `verify_sign` recomputed and compared with `timingSafeEqual` (`apps/api/src/modules/payments/webhook.ts:36-43`); gateway status gate (`:48-51`); amount and currency verified against the stored payment (`:60-72`); `PENDING → SUCCEEDED` claim is the single idempotency gate (`:85-92`) | `apps/api/tests/payments-integrity.test.ts:150,176`; `apps/api/tests/payments-webhook-amount.test.ts:56,68,79,93`; `apps/api/tests/payment-confirm-webhook-race.test.ts:45` | The webhook has no timestamp window; replay of an already-final webhook is a no-op but still accepted, and a superseded intent is left for manual reconciliation (`:94-96`) |
| AC-09 | Malicious or oversized upload to `POST /disease/cases` | Tampering / DoS | F1, F3 | Stored malware-like payloads, memory pressure, PII in EXIF | MIME allowlist, 8 MB cap, magic-byte check (`apps/api/src/modules/disease/routes.ts:18-19,45-54`); raw read ceiling with continued drain (`:214-226`); JPEG EXIF stripped, malformed JPEG rejected (`:70-80`); orphan cleanup on insert failure (`:104-124`) | `apps/api/tests/disease-upload-hardening.test.ts:22,41,53,76`; `apps/api/tests/security-matrix.test.ts:77` | PNG/WebP metadata passes through unchanged (documented in the route comment); no malware scanning is performed |
| AC-10 | SSRF through a provider URL | Tampering | F3 | Server-side requests to attacker-chosen hosts | No request URL is derived from user input: outbound calls use env-configured or fixed bases (`apps/api/src/providers/ai/openai-compat.ts:161`, `apps/api/src/providers/weather/openweather.ts:12`, `apps/api/src/providers/storage/s3.ts:66`, `apps/api/src/providers/payment/sslcommerz.ts:52`) | No dedicated SSRF test exists | An operator setting `OPENAI_BASE_URL`/S3 endpoint to a hostile value is out of application control; discovery endpoints are not used |
| AC-11 | XSS in the SPA or API responses | Tampering | F5, F1 | Session/token theft (ADR-0003) | React escapes rendered content; no `dangerouslySetInnerHTML` in `apps/web/src`; API responses are JSON with `X-Content-Type-Options: nosniff` and a hash-pinned CSP on the SPA (`apps/web` release preflight; live headers in `.audit/evidence/E-V2-live-probes.txt`) | `apps/api/tests/security-observability.test.ts:60` covers API security headers; no dedicated XSS test | Any future raw-HTML sink or dependency injection point is uncovered; CSP mitigates but does not eliminate script execution on the origin |
| AC-12 | CSRF against authenticated endpoints | Spoofing | F1 | Unauthorised state change | The API authenticates with a bearer `Authorization` header only and sets no auth cookie; CORS reflects only configured origins (`apps/api/src/app.ts:60-68`); origin list is production-filtered (`apps/api/src/config/env.ts`) | `apps/api/tests/cors-origin-policy.test.ts:11,16,22`; `apps/api/tests/security-observability.test.ts:98` | If a future change moves tokens to cookies, this control must be revisited with explicit CSRF defence (OD-02 option b) |
| AC-13 | Rate-limit evasion behind shared NAT or forged proxy headers | DoS | F1 | Endpoint exhaustion | Global limiter 300 per 15 min on `/api/*` (`apps/api/src/app.ts:76-87`); auth-heavy endpoints have their own limiters; financial and checkout limiters key by authenticated user (`apps/api/src/modules/marketplace/routes.ts:26-43`, `apps/api/src/modules/payments/routes.ts:31-45`); `trust proxy` is explicit (`apps/api/src/app.ts:54`); Redis store shared when configured (`apps/api/src/app.ts:29-30`) | `apps/api/tests/rate-limit-envelope.test.ts:18`; `apps/api/tests/rate-limit-redis.test.ts:113,136`; `apps/api/tests/auth-rate-limit-envelope.test.ts:12` | With the memory store the effective quota is instances × limit; the fail-open is documented (`docs/security.md`) |
| AC-14 | Secret leakage through logs, metrics, or error bodies | Information disclosure | F1, F2 | Credential and PII exposure | Pino redaction list covers authorization headers, passwords, tokens, phone, coordinates (`apps/api/src/shared/logging/logger.ts:11-25`); `/metrics` is private-network or token guarded in production (`apps/api/src/middleware/metricsGuard.ts:20-31`); production startup refuses default JWT secrets (`apps/api/src/config/env.ts:134-141`); CI runs Gitleaks (`.github/workflows/ci.yml`, `gitleaks` job) | `apps/api/tests/log-redaction.test.ts:10`; `apps/api/tests/security-observability.test.ts:67,74` | Error envelopes carry a `reference` and request id, not messages; a new log field carrying PII would need an explicit redaction path |
| AC-15 | Prompt injection against the AI advisory | Tampering | F7 | Harmful or off-policy farming advice | Questions are sanitised, the model prompt separates user and reference roles, and no tool/action surface is exposed (`apps/api/src/providers/ai/gateway.ts`; `apps/api/src/providers/ai/knowledge.ts`) | `apps/api/tests/ai-prompt-injection.test.ts:140,197,218,238`; `apps/api/tests/ai-eval.test.ts` (injection neutralisation, out-of-domain refusal) | Answers remain advisory only; low-confidence answers carry an expert-verification note, and KB provenance itself is a separate open item (OD-14) |
| AC-16 | Mass account creation | DoS | F1 | Fake accounts, notification/SMS abuse | Registration limiter 10 per hour per IP (`apps/api/src/modules/auth/routes.ts:79-87`); self-service registration is farmer-only (`apps/api/src/modules/auth/routes.ts:128-150`) | `apps/api/tests/auth-rate-limit-envelope.test.ts` (limiter envelope class); no registration-specific abuse test exists | Phone verification is the only identity check and is not deliverable in production today (OD-15) |

## STRIDE coverage by container

| Container / flow | Spoofing | Tampering | Repudiation | Info disclosure | DoS | Elevation |
|---|---|---|---|---|---|---|
| F1 SPA/WebView → API | AC-01, AC-02, AC-03, AC-12 | AC-09, AC-16 | — (audit log below) | AC-04, AC-14 | AC-13, AC-16 | AC-05 |
| F2 API → PostgreSQL | — | AC-07 | Audit middleware writes actor/action/entity rows (`apps/api/src/middleware/audit.ts`) | AC-04, AC-06 | Coverage limits on list queries (`take` caps, e.g. `apps/api/src/modules/marketplace/routes.ts:186-200`) | AC-05, AC-06 |
| F3 API → providers | — | AC-10 | AI usage rows and payment refs (`apps/api/src/providers/ai/gateway.ts`, `apps/api/src/modules/payments/routes.ts`) | Data minimisation in provider calls (grounding context only) | Provider timeouts: weather 8 s, AI 20 s, S3 30 s (`apps/api/src/providers/weather/openweather.ts:5`, `apps/api/src/providers/ai/openai-compat.ts:34`, `apps/api/src/providers/storage/s3.ts:75`) | — |
| F4 Gateway webhook | AC-08 | AC-08 | Payment audit row + notification on confirm | Signature failure logs minimal info (`apps/api/src/modules/payments/webhook.ts:39-42`) | Signature check runs before any DB work | — |
| F5 Edge bundle | — | AC-11 | — | CSP, `Referrer-Policy`, `Permissions-Policy` (live headers, `.audit/evidence/E-V2-live-probes.txt`) | Static delivery | — |
| F6 Offline replay | — | `clientUuid` idempotency server side (ADR-0009); checkout excluded from the queue (`apps/web/src/lib/offlineQueue.ts:25`) | Queue entry carries a client uuid (`apps/web/src/lib/offlineQueue.ts:141-180`) | Owner-scoped replay (`apps/api/tests/farm-event-sync-scoping.test.ts:11`) | Bounded by the same API limiters | — |
| F7 AI knowledge flow | — | AC-15 | AI usage log per request (`apps/api/src/providers/ai/gateway.ts:92-118`) | Grounded refs only; no chain-of-thought stored | Hourly AI limiter 30 per user (`apps/api/src/modules/aiagent/routes.ts:23-31`) | No tool surface (AC-15) |

## Abuse cases without a dedicated test

These controls are implemented but not pinned by an automated test in this repository; they are
the first places to add coverage when the surface changes:

- AC-10 (SSRF): no request URL is user-controlled today, but no test asserts that property.
- AC-11 (XSS): API security headers are tested; the SPA has no automated XSS or DOM-sink test.
- AC-12 (CSRF): covered indirectly by CORS tests; no test asserts "no auth cookie is ever set".
- AC-16 (registration abuse): the limiter class is tested, not the registration-specific policy.
- Password policy beyond length (8-72 chars, `apps/api/src/modules/auth/routes.ts:102-106`) has no
  strength test.

## Repudiation and audit trail

Every state transition that moves money or authority writes an audit row through
`apps/api/src/middleware/audit.ts`: order checkout/cancel/delete, payment confirm/refund, payout,
procurement review transitions, withdrawal decisions, OTP verification, account deletion, AI
feedback, and admin user/region changes. The admin audit viewer is
`GET /api/v1/admin/audit-logs` (`apps/api/src/modules/admin/routes.ts:156-175`). Audit rows are
append-only from the application's perspective; there is no delete path exposed.
