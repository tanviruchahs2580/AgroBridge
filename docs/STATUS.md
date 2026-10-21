# STATUS

One page, current as of **2026-10-19 (+06:00)**. What is actually live, what is pilot-grade
simulation, what is waiting on owner decisions, and where the evidence for each claim sits. No
roadmap and no marketing: if a line here disagrees with the running system, the system is right and
this page is a bug. Production is `main`; the remediation work described in its own section below
lives on branch `audit/v2-remediation` and is **not deployed** until it is merged and released.

## Live in production

| Thing | State | Evidence |
|---|---|---|
| Repository | Branch `main` at `0ce54b59a93657df3c9292db47cd2821f8d8136c` | `.audit/v2/BASELINE.md` G0 |
| Web SPA | Deployed; `version.json` reports version `1.4.0`, commit `0ce54b5`, built 2026-10-19T03:50Z | live probe in `.audit/evidence/E-V2-live-probes.txt` |
| API | Deployed; `/health` reports commit `38718bf`, `env: production` | same probe file |
| Database | PostgreSQL on Neon; `/ready` reports `db: true`, schema applied 6/6, latest migration `20261018120000_order_idempotency_feedback_indexes` | same probe file |
| Public surfaces | `https://agrobridge-web.vercel.app` (web), `https://agro-bridge-api-vantiq-systems.vercel.app` (API) | `docs/runbooks/live-deployment.md` topology table |
| Web security headers | CSP (hash-pinned), HSTS preload, `X-Frame-Options: DENY`, `Permissions-Policy` without geolocation | live headers in the probe file |
| API error contract | Unknown routes return the structured envelope with `requestId` | live probe (`ROUTE_NOT_FOUND` example) |
| CI | 10/10 jobs green on `0ce54b5` (SQLite + PostgreSQL suites, web build/e2e, APK, docker, secret and container scans) | `.audit/v2/BASELINE.md` G1 |

Known production properties that are not defects but are easy to misread:

- `limiterStore: "memory"` — no `REDIS_URL` is set, so rate-limit windows are per function instance
  and fail open (`/ready`, `apps/api/src/app.ts:26-39`; documented in `docs/security.md`).
- API functions execute in `iad1` while the web edge answers from `bom1`; the function region is
  not pinned in the repository (`docs/runtime-contract.md`).
- `/metrics` is private-network or token guarded in production
  (`apps/api/src/middleware/metricsGuard.ts`).

## On the remediation branch — verified, not yet deployed (2026-10-19)

Branch `audit/v2-remediation` (PR #40). The live/pilot rows above keep describing production until
this is merged and released; these changes land with it:

| Change | What it does | Evidence |
|---|---|---|
| Durable uploads gate | `STORAGE_PROVIDER=db` keeps uploaded photos in the database, and deploy verification now fails any production that reports a non-durable storage provider | ADR-0012 (`docs/adr/0012-durable-uploads-in-database.md`); gate `.github/workflows/deploy-verify.yml:198-213` |
| Self-service password reset | forgot/reset endpoints with an SMS code; uniform responses, per-phone throttling; a successful reset rotates the password and revokes every refresh token | `apps/api/src/modules/auth/routes.ts:440-506`; web screen `apps/web/src/features/auth/Reset.tsx` |
| Real SMS delivery path | provider-agnostic HTTP gateway (`SMS_PROVIDER=http` + `SMS_API_URL`/`SMS_API_KEY`); production boot aborts if `http` is selected without credentials. Still `sandbox` (codes only logged) until the owner supplies them | `apps/api/src/config/env.ts:63-72`, `:171-173` |
| Offline write-queue policy | Allow-listed mutations queue and replay with `clientUuid` idempotency; the queue is session-scoped, so a shared phone cannot replay one account's writes under the next account | ADR-0009 (`docs/adr/0009-offline-sync-policy.md`); `apps/web/src/lib/offlineQueue.ts:5-13,212-248` |

The go-live cutover for these (which environment values flip, in what order) is
`docs/play/launch-checklist.md`.

## Pilot-grade simulation (works, but not the real thing)

| Surface | Current mode | What a user sees |
|---|---|---|
| Payments | `PAYMENT_PROVIDER=sandbox`; in production the sandbox only runs behind an explicit opt-in flag | Sandbox label and message; no real money moves (`apps/api/src/modules/payments/routes.ts:105-210`) |
| Payment gateway webhook | Implemented and signature-verified, but the live SSLCommerz adapter is not activated | `docs/runbooks/live-deployment.md`; decision OD-07 |
| Weather | Placeholder provider accepted in production (`ALLOW_PLACEHOLDER_PROVIDERS=1`) | Weather cards render provider data with provenance fields; live OpenWeather requires credentials (`docs/runbooks/live-deployment.md` env table) |
| AI advisory | Offline grounded engine; hosted OpenAI-compatible provider requires credentials | Answers are grounded in the in-repo knowledge base with a KB version and disclaimer (`docs/ai.md`) |
| SMS / OTP delivery | `SMS_PROVIDER=sandbox`: codes are logged, not delivered (a real HTTP gateway path is wired on the remediation branch; it needs owner credentials — see that section) | Phone verification cannot complete for real users (OD-15) |
| Disease photo review | Uploads are stored durably in the database and queued as `PENDING_REVIEW`; there is no classifier and no agronomist queue UI for reviewers | `apps/api/src/modules/disease/routes.ts`; `docs/play/data-safety.md` |
| Storage | `STORAGE_PROVIDER=db` — uploads survive redeploys; `local` disk is rejected for production | `apps/api/src/providers/storage/index.ts`; ADR-0012 |

## Deferred — owner decisions (from `.audit/v2/DECISIONS.md`)

These are open decisions, not bugs; the linked IDs are the register's own identifiers.

| Area | Decision needed | Register ID |
|---|---|---|
| Schema strategy | Keep dual-dialect (SQLite dev + PostgreSQL prod) with a drift gate, or move to PostgreSQL-only | OD-01 |
| Session transport | Keep localStorage tokens (ADR-0003 risk) or move to memory + httpOnly refresh cookie before real money | OD-02 |
| Async work | Keep all work inline (no queue) or introduce an outbox + workers | OD-03 |
| Object storage | Activate S3-compatible storage or accept database-backed uploads | OD-04 |
| Tenancy backstop | App-level scoping only, or Postgres RLS as defence in depth | OD-05 |
| SLOs and alerting | Adopt the proposed objectives in `docs/slo.md`, and name an alert sink/on-call destination | OD-06 |
| Live payments | Activate SSLCommerz live only after the readiness gate | OD-07 |
| Android release | Keystore, FCM, signing, listing submission | OD-08 |
| Legal and domain | Counsel review of policies and a real domain before store submission | OD-09 |
| UI freeze | Keep frozen until the design-debt register is reviewed | OD-10 |
| Review policy | Solo maintainer, zero approvals — accept or add a reviewer | OD-11 |
| Production write tests | Keep denied, or allow throwaway-account writes | OD-12 |
| Upload-loss severity | Whether ephemeral-upload loss is treated as S1 or S2 | OD-13 |
| Knowledge-base provenance | Severity of unsourced KB entries pending agronomist review | OD-14 |
| SMS provider | Integrate a real SMS provider now or disable phone-gated flows in the pilot | OD-15 |
| Remediation mode | Whether local remediation on a branch is authorized | OD-16 |
| Dependency PRs | Triage of the open Dependabot pull requests | OD-17 |

The in-repo tasks that accompany these are the native-Bangla and agronomy reviews
(`docs/agronomy-review-sheet.md`) and the Play readiness checklist
(`docs/play/store-readiness-checklist.md`).

## Where the evidence lives

| Location | What it holds |
|---|---|
| `qa-evidence/receipts/` | Dated receipts (index: `qa-evidence/receipts/README.md`): round results, live verification, schema-drift and release-contract checks, web edge/delivery measurements |
| `qa-evidence/` (top level) | Gate logs from earlier rounds (API/web suites, e2e runs, load test, live probes) and probe scripts |
| `.audit/v2/BASELINE.md` | The current identity/toolchain/topology record and gate results for commit `0ce54b5` |
| `.audit/v2/FINAL_AUDIT_REPORT.md`, `FINDINGS.md`, `RISK_REGISTER.md`, `CLAIMS_LEDGER.md`, `SCORECARD.md` | Detailed findings, claim-by-claim verification and the risk register |
| `.audit/v2/DECISIONS.md` | The decision register summarized above |
| `.audit/evidence/` | Raw probe outputs (live headers, health payloads) |
| `docs/qa/test-traceability.md` | Capability → test file → CI job mapping |
| `docs/qa/score-deductions.md` | Every remaining parameter below 3, what closes it, and which rows the documentation wave moved |
| `docs/play/launch-checklist.md` | The credential/secret inventory and go-live order of operations for Play |
| `docs/retention-and-logs.md` | Log fields/redaction, retention defaults, and how to configure platform log retention |
| `docs/slo.md` | Proposed objectives, metric backing, alert mapping |
| `docs/threat-model.md` | Controls with code locations and the tests that pin them |

## Reading this page safely

Claims here are dated. Re-verify before quoting them externally: the live probe values come from
2026-10-19 and production moves without this file. Anything not listed as live or pilot is either
deferred to the owner or not implemented.
