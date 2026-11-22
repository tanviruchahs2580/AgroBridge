# Remediation progress ledger

Source of the work-package cards: `AgroBridge-Remediation-Master-Prompt-v1.0.md` (2026-11-21 audit
response). Finding IDs resolve in `docs/remediation/finding-register.md`. The narrative plan and the
owner decisions recorded on 2026-11-22 live in `docs/remediation-plan-2026-11.md`; live/simulated
truth lives in `docs/STATUS.md`.

Status vocabulary: `TODO` · `IN-PROGRESS` · `PR-OPEN` · `BLOCKED-DECISION (DR-nn)` ·
`BLOCKED-OWNER (OA-nn)` · `DONE` · `N/A (evidence)`.

| WP | Card | Status | Evidence / notes |
|---|---|---|---|
| WP-00 | Baseline, ledger, finding register | **DONE** | `qa-evidence/receipts/2026-11-23-remediation-baseline.md`; ledger + register created (docs PR). Baseline: all §5 gates green on `534bad7` except knip (machine-limited, CI runs it); Node-24 deviation recorded |
| WP-01 | Refresh limiter per token; client survives transient 429/5xx | **DONE** (2026-11-22, PR #108) | SEC-01; `tests/auth-refresh-limiter.test.ts` + web `api.test.ts` (429/5xx keep session, 401 clears) |
| WP-02 | Order/account-deletion guards | **DONE** (2026-11-22, PR #108), with a delta | SEC-03/PAY-06/CMP-01: buyer delete restricted to `CANCELLED`/`REFUNDED` (PAID is a record, not erased); `DELETE /auth/me` blocks only in-flight orders. Delta vs the card: shipped the allow-list + DR-03 default rather than `archivedAt` archive semantics — a settled order is deleted only when terminal, which is the stronger guarantee the finding required; archive UI can be layered later if the owner wants it |
| WP-03 | SSLCommerz conformance (docs-derived signature, validator-authoritative settlement) | **IN-PROGRESS** (2026-11-23) | Official docs retrieved 2026-11-22 (developer.sslcommerz.com/docs.html); real-fixture capture stays BLOCKED-OWNER (OA-01) |
| WP-04 | SMS provider readiness (owner-independent parts) | **PR-OPEN** (2026-11-23) | send metric + smoke script + adapter tests + activation runbook; OTP-never-logged grep proof in the PR. Activation and real delivery proof BLOCKED-OWNER (OA-02, gate G1); step-up gates un-waive automatically on activation |
| WP-05 | Redis limiter readiness | **IN-PROGRESS** (2026-11-23) | provisioning BLOCKED-OWNER (OA-03) |
| WP-06 | OTP / reset hardening | **DONE** (2026-11-22, PR #108), with a delta | SEC-03: atomic attempt claim, normalised limiter keys. Delta: HKDF domain separation from `JWT_ACCESS_SECRET` (`shared/utils/kdf.ts`) instead of a new `OTP_HMAC_SECRET` env var — one less secret to rotate; recorded in the plan doc §3 |
| WP-07 | Mandatory `API_PUBLIC_URL` for live payments | **DONE** (2026-11-22, PR #108) | SEC-05; `liveGatewayPublicUrlProblem` startup guard |
| WP-08 | Token storage (08a Android secure storage · 08b web cookie) | **PARTIAL** | 08b **DONE** (PR #108: HttpOnly `ab_rt` + CSRF double-submit, zero tokens in localStorage — went past the card's flag-off default on the owner's decision, plan doc §3). 08a BLOCKED-OWNER: Keystore-backed plugin needs an approved dependency change (§9) and UJ-09 device verification, which only the owner can run |
| WP-09 | Latency probe + region decision memo | **IN-PROGRESS** (2026-11-23) | DR-11/OA-12 stay open |
| WP-10 | Error tracking, alerting, runbooks | **TODO** | gated: Sentry deps (§9) + DSNs/accounts (OA-05) |
| WP-11 | Advisory safety switch + KB review process | **PARTIAL** | owner recorded **serve-with-warning** on 2026-11-22 (plan doc §2) — the card's suppression default is superseded; the `unreviewedTreatmentRequired` warning path ships and is tested. Remaining: KB review process doc + REVIEWED-promotion guard (IN-PROGRESS 2026-11-23) |
| WP-12 | Licence/legal-entity memo | **N/A (evidence)** | owner decision recorded 2026-11-22: keep MIT until public release/distribution (plan doc §2, revisit trigger stated) |
| WP-13 | Backup/restore drill tooling | **IN-PROGRESS** (2026-11-23) | the drill itself is BLOCKED-OWNER (OA-06, gate G4) |
| WP-14 | Admin MFA + step-up | **DONE** (2026-11-22, PR #108 + #110), with follow-ups | TOTP (admin tier) + SMS step-up on withdrawals/account deletion; #110 waives the step-up gates while SMS is a placeholder (un-waive = the OA-02 activation). Follow-ups recorded in plan doc §4.2: recovery codes, maker-checker threshold |
| WP-15a | Shared vocabularies, status-scan test, PG CHECK constraints, orphan report, migration playbook | **PARTIAL** | DAT-01 slice done (PR #108: `REFUNDED` in schema comments + vocabulary); the rest TODO |
| WP-15b | PostgreSQL-only | **BLOCKED-DECISION (DR-01)** | ADR-0004 binds until the owner approves a superseding ADR |
| WP-16 | Service-layer refactor | TODO | |
| WP-17 | Double-entry ledger | **BLOCKED-DECISION (DR-06)** | design memo only until finance sign-off (OA-14) |
| WP-18 | Outbox + workers | **BLOCKED-DECISION (DR-07)** | design memo only until approved |
| WP-19 | OpenAPI from route inventory + Zod | **IN-PROGRESS** (2026-11-23) | |
| WP-20 | Fulfilment module | **BLOCKED-DECISION (DR-08)** | design memo only |
| WP-21 | Offline read cache | **BLOCKED-DECISION (DR-04)** | memo only; no service worker (ADR-0008/0009 bind) |
| WP-22 | Auth hot-path cache | **N/A (evidence)** | precondition (load-test evidence of a bottleneck) unmet; DB is co-located, per-request read ≈1.2 ms measured |
| WP-23 | Image intake pipeline | **IN-PROGRESS** (2026-11-23) | |
| WP-24 | Tracing + SLO adoption | **BLOCKED-OWNER (OA-05)** | SLO sign-off + vendor sink; spans need an approved dep |
| WP-25 | One deployment path, IaC, secrets | TODO (memo) | |
| WP-26 | Governance / bus factor | **BLOCKED-OWNER (OA-11)** | docs deliverable this session; ruleset changes are the owner's |
| WP-27–34 | Wave 5 | TODO / BLOCKED | mostly decision-gated; tracked in plan doc §5 P2 |
| QW-01 | Masked audit PII | **DONE** (PR #108) | `tests/audit-pii-masking.test.ts` |
| QW-02 | Registration-response trade-off documented | **IN-PROGRESS** (2026-11-23) | |
| QW-03 | Docs truthfulness | **PARTIAL** | ARC-07 tenancy reword done (PR #108); remaining checks land with the docs pass |
| QW-04 | Literal `SSLCOMMERZ_SANDBOX` | **DONE** (PR #108) | |
| QW-05 | Zod caps on single-amount inputs | **PR-OPEN** (2026-11-23) | MAX_SINGLE_AMOUNT_PAISA (2B) on product price, service base price, withdrawal amount; boundary tests; DAT-02 storage widening stays with WP-17 | |
| QW-06 | No hand-written counts in docs | **IN-PROGRESS** (2026-11-23) | |
| QW-07 | Android FileProvider/minify | **BLOCKED-OWNER (UJ-09)** | CI-only build; the card forbids merging without owner device verification |
| QW-08 | Audit-narrative comments → why+ADR | **N/A (policy)** | ongoing discipline, applied when touching a file |

Merging policy: every PR treats **every** CI job as required (§5 of the master prompt), including the
non-required-status-check jobs. PRs are squash-merged per repo convention once the full matrix is
green, following the owner-delegated pattern recorded for the 2026-11-22 session.
