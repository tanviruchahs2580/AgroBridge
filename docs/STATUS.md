# STATUS

One page. Live rows as of **2026-11-03 (+06:00)**; corrected **2026-11-10** (branch protection, CI
wording, evidence availability) without a production re-probe. What is actually live, what is
pilot-grade simulation, what is waiting on owner decisions, and where the evidence for each claim
sits. No roadmap and no marketing: if a line here disagrees with the running system, the system is
right and this page is a bug. Production is `main`.

> **Released 2026-11-03: production runs `3f1c991`, and every live row below was re-probed.** The
> quiet-surfaces pass (PR #90) is deployed, on top of the enterprise hardening (#88) and the Bengali
> source-citation fix (#89) that had been live since 2026-10-30 without a STATUS update — this
> revision covers all three. The deploy-verification gate passed on the merge, and the live site was
> checked by content, not by assumption: the shipped entry chunk carries none of the twelve strings
> the pass removed and every replacement, and the debug APK CI built from the same commit bundles a
> byte-identical web chunk (SHA-256 `c3df0367…`). Highlights are in the CHANGELOG's 2026-11-03
> entries. The previous revision of this page described the 2026-10-29 release at `3e8b5c4`; it is
> superseded.

> **2026-11-10 corrections (docs-integrity pass — see `docs/audit/2026-11-10-full-qa-audit.md`).**
> The branch-protection row was wrong in the repository's favour: the legacy
> `/branches/main/protection` endpoint 404s, but ruleset `25297401` (`main — protected`) is active
> — see the owner-decision register below. The CI row no longer claims a browser-suite size ("52
> specs" was stale; the suite is 22 Playwright spec files, `ls apps/web/e2e/*.spec.ts | wc -l`).
> "Where the evidence lives" now states which citations are committed and which are not. Production
> was not re-probed by this pass; the audit's §3.6 records its own 2026-11-10 probes.

## Live in production

| Thing | State | Evidence |
|---|---|---|
| Repository | Branch `main` carries the 2026-11-03 release `3f1c991` (#88, #89, #90); everything after it is docs-only release records (#91, #92) | `git log origin/main` |
| Web SPA | Deployed; `version.json` reports version `1.4.1`, commit `3f1c991`, built 2026-11-03T09:17Z | live probe (curl, 2026-11-03) |
| API | Deployed; `/health` reported commit `3f1c991`, `env: production` | live probe (curl, 2026-11-03); the 2026-11-10 audit re-probe reports `d205f76` — a docs-only rebuild of the same code (§3.6 of `docs/audit/2026-11-10-full-qa-audit.md`) |
(fix: audit remediation — money, authorisation, AI, release path (AUD-2026-11-10-FULL))
| Android artifact | CI's `agrobridge-debug-apk` for `3f1c991` bundles the same web build as that deployment's web (entry chunk byte-identical, SHA-256 `c3df0367…`, 404,950 bytes), `versionName` 1.4.1. The later docs-only build differs only in the compiled-in stamp — same byte length, differences confined to Vite's `__vite__mapDeps` table | `gh run download 41609544999`; not installed — no device or emulator on the verification machine |
| Database | PostgreSQL on Neon; `/ready` reports `db: true`, schema applied 11/11, latest migration `20261024020000_otp_live_challenge_unique` | live probe (curl, 2026-11-03) |
| Public surfaces | `https://agrobridge-web.vercel.app` (web), `https://agro-bridge-api-vantiq-systems.vercel.app` (API) | `docs/runbooks/live-deployment.md` topology table |
| Web security headers | CSP (hash-pinned), HSTS preload, `X-Frame-Options: DENY`, `Permissions-Policy` without geolocation | live headers; the build fails if the two Vercel configs diverge |
| API error contract | Unknown routes return the structured envelope with `requestId` | live probe (`ROUTE_NOT_FOUND` example) |
| CI | Release PR #90 passed **19/19 checks** (the CI jobs incl. the SQLite + PostgreSQL suites and the Playwright browser suite — 22 spec files, `ls apps/web/e2e/*.spec.ts | wc -l` — plus CodeQL, ZAP DAST, Docker build + compose smoke, Trivy, gitleaks, both Vercel previews); push-to-main CI, CodeQL and Deploy verification were green on `3f1c991` | `gh pr checks 90`, Actions runs for `main` |

Known production properties that are not defects but are easy to misread:

- `limiterStore: "memory"` — no `REDIS_URL` is set, so rate-limit windows are per function instance
  and fail open (`/ready`; `docs/security.md`). **Provisioning Redis is now safe for the
  account-recovery path**: until 2026-10-29 four auth limiters shared one store instance, which
  Redis would have turned into a 500 on OTP request/verify and password forgot/reset (PR #81).
- API functions execute in `iad1` while the web edge answers from `bom1`; the function region is
  not pinned in the repository (`docs/runtime-contract.md`).
- `/metrics` requires `METRICS_TOKEN` in production — the private-address allowance was an
  allow-everything rule behind the platform LB (verified live 2026-10-23; fixed on
  `audit/v3-remediation` with a fail-closed token guard).

## Earlier remediations — now deployed, kept as the record (2026-10-24)

The section that follows describes the AUD-V3 deep-audit remediation. It is **historical**: that
work reached `main` (PR #70) and is part of what production runs today, so nothing here is pending.
It is kept because the table is the only one-page account of what that wave changed and why; the
"owner actions when releasing this branch" note below it is satisfied (the secrets are set, the boot
gate enforces entropy, the cron and metrics guards are live).

| Change | What it fixes | Evidence |
|---|---|---|
| Live-gateway verification keys + amount cross-check | The SSLCommerz reconciliation paths posted the session key as `val_id`/`orderNo` and skipped the webhook's amount cross-check | `apps/api/src/providers/payment/sslcommerz.ts`; `reconcileLiveVerdict` in `modules/payments/routes.ts`; `tests/payments-reconciliation-amount.test.ts` |
| Retention actually scheduled | The policy ran nowhere in production; four tables grew without bound. Daily Vercel cron + `CRON_SECRET`, 180-day windows now cover analytics/notifications/AI logs/advisory queries | `apps/api/src/shared/retention.ts`; `apps/api/vercel.json` crons; `tests/ops-retention-endpoint.test.ts` |
| `/metrics` fails closed | Anonymous production access returned the full Prometheus output (verified live) | `apps/api/src/middleware/metricsGuard.ts`; `tests/metrics-guard-prod.test.ts` |
| Offline-queue flush mutex + critical-flow cleanup | Boot double-flush double-sent queued writes; the checkout 401-guard leaked past unmount | `apps/web/src/lib/offlineQueue.ts`; `Market.tsx` unmount cleanup; mutex + cross-tab tests |
| Three claim-atomic state machines | Crop-cycle/disease-review/booking-assign races now settled by DB predicates + the `CropCycle_plot_id_active_key` partial unique | `tests/state-machine-races.test.ts`; both migration chains `20261024000000`/`020000` |
| JWT secret entropy gate | Production refuses JWT secrets < 32 chars (RFC 8725) | `apps/api/src/config/env.ts`; rotation: `docs/runbooks/secret-rotation.md` |
| Uptime probe + lint ratchet + loadtest gate fix | External 15-min reachability probe; eslint warning budget in CI; the AI phase no longer structurally fails the loadtest gate | `.github/workflows/uptime-probe.yml`; `scripts/qa/lint-budget.mjs`; `apps/api/scripts/loadtest.mjs` |
| Dev toolchain cleared | vitest 4.1.12 + vite 6.4.5 — zero advisories left in any audit surface | `npm audit --workspaces` post-upgrade; suites 514/198 green |

Owner actions when releasing this branch: set `CRON_SECRET` and `METRICS_TOKEN` in the Vercel
project env, and confirm the JWT secrets are ≥ 32 chars (the boot gate enforces it from this
release on). The go-live cutover order remains `docs/play/launch-checklist.md`.

## Pilot-grade simulation (works, but not the real thing)

| Surface | Current mode | What a user sees |
|---|---|---|
| Payments | `PAYMENT_PROVIDER=sandbox`; in production the sandbox only runs behind an explicit opt-in flag | Sandbox label and message; no real money moves (sandbox-mode copy and the provider-mode gate in `apps/api/src/modules/payments/routes.ts`) |
| Payment gateway webhook | Implemented and signature-verified, but the live SSLCommerz adapter is not activated | `docs/runbooks/live-deployment.md`; decision OD-07 |
| Weather | Placeholder provider accepted in production (`ALLOW_PLACEHOLDER_PROVIDERS=1`) | Weather cards render provider data with provenance fields; live OpenWeather requires credentials (`docs/runbooks/live-deployment.md` env table) |
| AI advisory | Offline grounded engine; hosted OpenAI-compatible provider requires credentials | Answers are grounded in the in-repo knowledge base with a KB version and disclaimer (`docs/ai.md`) |
| SMS / OTP delivery | `SMS_PROVIDER=sandbox`: codes are logged, not delivered (the real HTTP gateway path is wired and deployed; it needs owner credentials) | Phone verification cannot complete for real users (OD-15) |
| Disease photo review | Uploads are stored durably in the database and queued as `PENDING_REVIEW`; there is no classifier and no agronomist queue UI for reviewers | `apps/api/src/modules/disease/routes.ts`; `docs/play/data-safety.md` |
| Storage | `STORAGE_PROVIDER=db` — uploads survive redeploys; `local` disk is rejected for production | `apps/api/src/providers/storage/index.ts`; ADR-0012 |

## Deferred — owner decisions (from the audit decision register)

These are open decisions, not bugs; the linked IDs are the register's own identifiers. The register
itself (`.audit/v2/DECISIONS.md`) is **not in this repository** — see §Where the evidence lives.

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
| Branch protection | **Enforced — the earlier reading of this page was wrong.** Ruleset `25297401` (`main — protected`, enforcement `active`) requires a pull request (approvals **0**), linear history, blocks deletion and force-push, and gates on 11 required status checks (`gh api repos/…/rulesets/25297401`, checked 2026-11-10). The legacy `/branches/main/protection` endpoint 404s for rulesets and is what the 2026-11-03 revision misread; `docs/archive/2026-10-19/generated/governance-branch-protection.md` explains the endpoint difference. Remaining decisions: the migration-drift job, the `quality-gates` job, compose smoke, the IaC scan and ZAP are **not** required checks — add them to the ruleset (recommended) or record that convention is enough; and decide whether approvals should stay at 0 | — |
| Dependency PRs | Triage of the open Dependabot pull requests | OD-17 |

The in-repo tasks that accompany these are the native-Bangla and agronomy reviews
(`docs/agronomy-review-sheet.md`) and the Play readiness checklist
(`docs/play/store-readiness-checklist.md`).

## Where the evidence lives

| Location | What it holds |
|---|---|
| `qa-evidence/receipts/` | Dated receipts (index: `qa-evidence/receipts/README.md`): round results, live verification, schema-drift and release-contract checks, web edge/delivery measurements — **committed** |
| `qa-evidence/` (top level) | Gate logs from earlier rounds (API/web suites, e2e runs, load test, live probes) and probe scripts — **local only, not committed**; unavailable from a clone |
| `.audit/**`, `.audit-archive/**`, `.agent-evidence/**` | The 2026-10/11 audit working trees (`.audit/v2/{BASELINE,FINAL_AUDIT_REPORT,FINDINGS,RISK_REGISTER,CLAIMS_LEDGER,SCORECARD,DECISIONS}.md`, `.audit/evidence/E-V2-live-probes.txt`, …) — **not in this repository**. The originals survive only under `.audit-archive/pre-v3-final-20261030/` on the machine that produced them; every tracked-document citation to them is currently **unverifiable from a clone** (F-21, `docs/audit/2026-11-10-full-qa-audit.md`). Do not treat those citations as reproducible evidence until the owner decides whether to publish a curated evidence tree |
| `docs/qa/test-traceability.md` | Capability → test file → CI job mapping |
| `docs/qa/score-deductions.md` | Every remaining parameter below 3, what closes it, and which rows the documentation wave moved |
| `docs/play/launch-checklist.md` | The credential/secret inventory and go-live order of operations for Play |
| `docs/retention-and-logs.md` | Log fields/redaction, retention defaults, and how to configure platform log retention |
| `docs/slo.md` | Proposed objectives, metric backing, alert mapping |
| `docs/threat-model.md` | Controls with code locations and the tests that pin them |

## Reading this page safely

Claims here are dated. Re-verify before quoting them externally: the live-row probes date from
2026-11-03 (and the 2026-11-10 audit's own probes are recorded in
`docs/audit/2026-11-10-full-qa-audit.md` §3.6), and production moves without this file. Anything not
listed as live or pilot is either deferred to the owner or not implemented.
