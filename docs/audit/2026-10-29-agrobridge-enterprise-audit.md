# COMPLETE — VERIFIED AT c163de5

AgroBridge enterprise SWE audit, remediation and release-readiness review.
Repository: https://github.com/tanviruchahs2580/AgroBridge
Report date: 2026-10-29. Prompt: *Master Prompt V3* (catalog v3, 185 items).

> **Verdict: `COMPLETE`.** All mandatory gates passed, no S0/S1 finding is open,
> the candidate SHA is verified by the repository's own CI on a clean runner, and
> the acceptance run and evidence bundle are recorded below. Two items are
> explicitly owner-blocked rather than closed (an agronomist review and
> infrastructure drills); they are named in Limitations and Owner Actions, and
> neither is a mandatory gate under §2.4.
>
> **Provenance of this document.** The audit was performed at the candidate SHA
> `980bf41`; the verified SHA is `c163de5`, one docs-only commit later (a regenerated
> `docs/env-reference.md`, 2 lines, required by the generated-docs-freshness gate).
> This report is itself committed in a docs-only commit on top of that; no runtime code
> differs across the three. CI re-ran every required check on each.

> **Scoring note, because "COMPLETE" and the band disagree — deliberately.**
> The score is a weighted coverage measure of 185 catalog items; the verdict is a
> gate measure. Every mandatory gate passed, yet Domain A (agritech) scores 76.0%
> and Domain I (observability/performance) 61.9% because the knowledge base has no
> sources and the operational drills cannot be executed without infrastructure.
> A high gate verdict with a mid-band score is the honest combination here; the
> scoring rules do not let a gate waive a missing source ledger, and they should
> not.

| Field | Value |
|---|---|
| Baseline SHA | `287a8b1e83e8b2719069e776953c9e8acc9ea231` (also the SHA production was running at audit start, verified from `/health` and `version.json`) |
| Candidate SHA | `980bf410f326e4a97c2de909ead1ea797f1dab0c` |
| Final (verified) SHA | `c163de5d944752d3ab82b870ea51555e70ca3ea3` (docs-only descendant of the candidate: regenerated `docs/env-reference.md`) |
| Baseline score (uncapped) | **79.98 / 100** |
| Final score (uncapped) | **83.78 / 100** |
| Caps applied | **none** — all 15 §7.3 conditions evaluated with evidence in `.audit/score-caps.csv` |
| Final score (capped) | **83.78 / 100** → band **80–89: production-ready with explicit minor gaps and owner actions** |
| Score confidence | **Medium** — 119/180 applicable items (66.1%) carry verification-backed PASS evidence |
| Findings | 36 total: **3 S1 (all fixed)**, 11 S2, 22 S3; 18 verified-fixed, 4 deferred to owner, 14 open (none S0/S1) |
| Pull request | https://github.com/tanviruchahs2580/AgroBridge/pull/85 — `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN` |
| Production deployment performed | **No.** Merging is an owner action (see §11) |

## Gate table

| Gate | Name | Status | Evidence |
|---|---|---|---|
| G0 | Fresh-clone reproducibility | **PASS** | Documented chain executes: `npm ci` → `prisma validate/generate` → `migrate deploy` → `db seed` → build → boot → `/ready`. Executed in the working checkout at the final SHA on a freshly provisioned database; the CI `web-e2e` job performs the same sequence from a clean checkout on a clean runner. The *second* local clone's install is blocked by this host's disk (see Limitations). |
| G1 | Static quality and types | **PASS** | eslint 0 errors / 143 warnings at the ratchet; `tsc --noEmit` clean for both apps; knip, jscpd ≤3%, licence, TODO, route-matrix, ERD, generated-docs freshness all exit 0 |
| G2 | Automated tests | **PASS** | API 526 passed / 1 skipped (PG-gated, reasoned) / 0 failed at coverage 83.9/74.0/86.0/86.4 vs floors 82/72/84/84; PostgreSQL profile green in CI; web unit + E2E green in CI |
| G3 | Security and authorization | **PASS** | No open S0; the three S1s fixed with tests; auth/RBAC/tenant negative suites green; gitleaks (full history), npm audit (prod), CodeQL, Trivy config all green in CI |
| G4 | Transaction integrity | **PASS** | Checkout/stock, procurement/payout, wallet/ledger and callback invariants tested, including a new cancel-vs-payment race suite; ledger reconciles (`reconcile-wallet` run directly) |
| G5 | Agritech/AI correctness | **PASS with a named gap** | Grounded answers, citations resolving to store entries, tested abstention, provider fallback honesty, weather provenance, disease intake that never claims a diagnosis. The corpus itself is **unsourced** (AUD-135) — owner-blocked, disclosed in-product and in `docs/ai.md` |
| G6 | Performance/reliability | **PASS (provisional budgets)** | Front-end budgets measured and enforced (entry 132 kB gzip, etc.); API latency measured in a dated local report; `loadtest.mjs` exists with thresholds but is not a CI gate. No production SLO exists, so nothing here is claimed as an SLO |
| G7 | UX, Bangla, accessibility, offline | **PASS** | Browser journeys at 390×844 (chromium) plus firefox/webkit smoke; axe suite asserts zero critical/serious violations on login, error and authed routes; keyboard/focus specs; Bangla NFC-clean with no Assamese glyphs; offline queue distinguishes queued/synced/conflict/failed |
| G8 | AI-slop and truthfulness | **PASS** | S-01…S-22 sweep: no dead controls, no fabricated metrics, no fake progress, no placeholder text in shipped source; six stale documentation claims corrected in this branch |
| G9 | Docs and operations | **PASS with a named gap** | README/CONTRIBUTING commands all verified to exist and execute; docs link + claims gates green; six runbooks present and consistent with the scripts they cite — the staging/VM drills are unexecuted (Limitations) |
| G10 | CI/CD and supply chain | **PASS (read-only)** | 9 workflows inspected; all third-party actions SHA-pinned; least-privilege permissions; SBOM + signed provenance attestation; Trivy image/config, gitleaks, CodeQL, npm audit all wired. No deployment was executed by this audit |
| G11 | User-simulation acceptance | **PASS** | Repository acceptance journeys at the final SHA: chromium full suite + firefox/webkit smoke, against a freshly seeded synthetic database, with a real API and web server (see §9) |
| G12 | Git/release hygiene | **PASS** | 12 atomic Conventional Commits with finding refs, clean tree, no staged secrets/junk, CI hygiene gate green, no tag/release/deploy created |
| G13 | Report integrity | **PASS** | Evidence manifest with sha256 for 19 artifacts, 185 claim entries, claim-evidence lint clean, score/cap reconciliation by the Appendix B script plus an independent re-computation |

---

## 1. Executive summary

1. The repository is in materially better shape than its documentation implies: 526 passing API tests, 98 test files, a generated-and-drift-gated 85-route authorization matrix, three schema copies kept in enforced parity, and a CI pipeline that pins every action by SHA and runs E2E twice (dev server and production build).
2. Three S1 defects were found in the money paths and all three are fixed and regression-tested: a cancelled order could still be paid after its stock had been returned to the pool; one account could review and pay out its own procurement offer; and the live payment adapter reported `mode: "live"` while able to transact against the SSLCommerz sandbox.
3. Twelve further defects were fixed at S2/S3: a mislabeled upload could keep its GPS EXIF; a logout silently discarded queued offline work; the migration-drift gate failed on every local re-run; commitlint checked only the tip commit; two tests asserted nothing; booking copy used the server's timezone; a query string could 500 an admin endpoint; webhook rejections bypassed the error envelope; and six documentation claims had drifted from the code.
4. The score moved 79.98 → 83.78 uncapped, with no caps triggered. The remaining deduction is concentrated in two places: the **knowledge base has no sources** (every entry is `UNSOURCED`, which caps what the agritech domain can claim) and **operational evidence that needs infrastructure this audit must not touch** (backup/restore drills, a production load profile, the PostgreSQL profile locally).
5. The most consequential remaining risk is not a code defect: the review and audit of an agronomist-facing product cannot be done by an agent. Every AI evaluation item is flagged `synthetic: true, reviewedBy: null`, and the review sheet is still pending. Until a Bangladesh agronomist signs off, no claim about agricultural correctness should be made to a user.
6. Two owner decisions block further score: whether QC may re-measure the self-declared grade and moisture that fix a procurement payout, and whether a territory manager with no region should keep seeing every region's offers (documented as ODL-007, currently failing open).
7. No secret, credential or production datum was read or written. No deployment, release, tag or workflow dispatch was performed. The candidate branch is pushed and its PR is green and mergeable; the merge is left to the owner because merging automatically deploys to production.

## 2. Method and environment

| Item | Value |
|---|---|
| OS / shell | Windows 10.0.26300 x64, Git Bash |
| Runtime | node v24.19.0 (repo declares ≥22, CI pins via `.nvmrc`), npm bundled |
| Python | 3.12 (score script, Unicode scan, evidence manifest) |
| git / gh | 2.55.0.windows.5 / authenticated as `tanviruchahs2580` (read + push scopes) |
| Database | SQLite for the local profiles; PostgreSQL 17 in CI only (no local PG service) |
| Docker | CLI 29.7.2 + Compose v5.4.0 present, **daemon unverified** → container scans and compose smoke were not re-executed locally |
| Browser | Playwright 1.63.0, chromium (Pixel 5 / 390×844, bn-BD locale) plus firefox + webkit smoke projects |
| Configured providers | **test/placeholder only**: `WEATHER_PROVIDER=mock`, `AI_PROVIDER=offline`, `PAYMENT_PROVIDER=sandbox`, `SMS_PROVIDER=sandbox`, `STORAGE_PROVIDER=local`. No real provider key exists or was used |
| Budgets | No live AI spend (offline engine), no weather provider calls (mock), no payment gateway calls (sandbox), no external upload |
| Key commands | see Appendix B — every command is recorded in `.audit/evidence/gates-baseline.log`, `gates-final.log`, `local-acceptance.log` |
| Test data | synthetic only: the repository's seed (8 products, 8 services, 3 membership plans, 5 role accounts) on a dedicated `acceptance.db` |

**A note on the local gate battery.** Two long runs were started; the second was
stopped when CI had already executed the same gates on a clean runner at the same
SHA (the CI result is strictly better evidence than a locally contended run). The
first (baseline) run completed in full and is the source of §3's baseline numbers.

## 3. Scorecard

| Domain | Points | Baseline | Final | Final % | Largest remaining deduction |
|---|---:|---:|---:|---:|---|
| A. Agritech domain correctness & AI | 16 | 11.88 | **12.17** | 76.0% | A2-01/A2-07 (no sources), A8-04 (no agronomist), A3-01 (citations resolve to slugs) |
| B. Security, privacy, authorization | 14 | 11.64 | **11.88** | 84.9% | B-05 (registration/reset timing), B-02 (no `aud`), B-26 (container scans not re-run locally) |
| C. Marketplace & financial integrity | 12 | 10.02 | **11.22** | 93.5% | C-20 (QC cannot re-measure), C-15 (no reversal API), C-09 (free-text units) |
| D. Architecture, data, migrations | 10 | 7.79 | **8.53** | 85.3% | D-07 (PG profile locally), D-06 (client-side ordering), D-08 (no outbox) |
| E. Testing & QA | 10 | 8.24 | **8.38** | 83.8% | E-05 (PG locally), E-03 (adapters outside the coverage denominator), E-09 (no mutation testing) |
| F. CI/CD & supply chain | 8 | 6.62 | **6.62** | 82.8% | F-04/F-06 (container scans unverified locally), F-08 (no protected environment) |
| G. Frontend, Bangla, offline | 8 | 7.00 | **7.38** | 92.2% | G-06 (no assistive-technology audit), G-09 (partial failure isolation) |
| H. API & database quality | 7 | 6.12 | **6.38** | 91.1% | H-04 (one-directional contract parity), H-08 (secondary index gaps) |
| I. Observability, reliability, perf | 6 | 3.71 | **3.71** | 61.9% | I-07 (drills blocked), I-04/I-08 (no gated load profile), I-06 (no reconcile alerting) |
| J. Documentation & DX | 4 | 2.89 | **3.44** | 86.1% | J-03 (runbooks unexecuted), J-05 (no OpenAPI) |
| K. Git/GitHub governance | 5 | 4.06 | **4.06** | 81.2% | K-03 (CODEOWNERS advisory), K-05 (tag-push artifact path), K-07 (deferred findings not filed as issues) |
| **Total** | **100** | **79.98** | **83.78** | | |

**Caps.** All 15 §7.3 conditions were evaluated individually in `.audit/score-caps.csv`
with the evidence for and against each. None is triggered on the final SHA. Two were
considered at length and deliberately not applied, with the reasoning recorded there:
the "live AI/provider evaluation blocked" condition (no claim depends on a live model,
and Domain A at 76.0% is below that cap's 80% ceiling anyway) and the "fabricated
capability claim" condition (two README statements describe a degraded path
inaccurately rather than asserting a capability that does not exist).

**Reconciliation.** The Appendix B script produced the uncapped score from
`.audit/catalog-status.csv`; the arithmetic was reproduced independently from
`.audit/catalog-status-baseline.csv` and the cap register, and the two agree. The
script refuses to run if any catalog ID is unscored, if a PASS lacks evidence or a
PARTIAL lacks an explanation, so neither number is a hand total.

**Score confidence.** 119 of 180 applicable items (66.1%) carry verification-backed
evidence; the rest are PARTIAL (56), FAIL (3), BLOCKED (2) or N/A (5, each with an
absence proof). Reported as **Medium** confidence, not High, because a High rating
requires ≥95%.

## 4. As-built architecture

Full diagrams with file:line citations: `.audit/reports/architecture-as-built.md`
(all citations re-resolved at the candidate SHA by
`.audit/scripts/resolve-citations.py`). Summary of the flows the audit leaned on:

- **API request path.** helmet → CORS allow-list → body parsers → request context
  (request id + AsyncLocalStorage + traceparent) → metrics → admission/global
  limiters → `/health`, `/ready`, guarded `/metrics` → v1 router, with the payment
  webhook mounted unauthenticated by design and everything else behind per-router
  `requireAuth` + `requirePermission`.
- **Money path.** checkout decrements stock with a conditional update inside a
  transaction and carries a `clientRequestId` unique per user; `/payments/intent`
  supersedes stale intents inside its own transaction; success is decided only by a
  signature-verified webhook or a gateway lookup with an amount cross-check, then a
  claim-atomic `PENDING→SUCCEEDED` transition applies the side effects.
- **Two claims, one row.** Since this audit, cancelling voids a pending intent
  (`PENDING→FAILED`) and settlement claims it (`PENDING→SUCCEEDED`); they are
  mutually exclusive by construction, which is what closed the S1 oversell path.
- **AI path.** route → auth → per-user hourly limiter → zod → context assembly →
  provider resolution (offline engine by default) → retrieval over a 7-entry in-code
  corpus → confidence + citations → usage log → persisted advisory with engine and
  KB version. Hosted provider is optional and fenced.
- **Offline path.** a localStorage queue with a strict allow-list, 72 h TTL, owner
  stamping, single-flight replay and status-driven conflict policy; no service
  worker is registered at all, so the app never claims offline capability it lacks.
- **Trust boundaries.** internet→API, public→payment callback, authenticated→object,
  role→privileged action, app→provider, upload→storage, production config.

## 5. Critical workflow correctness

| Invariant | Before | After |
|---|---|---|
| Stock commitment while an order is payable | Cancelling released stock while a payment could still settle → a paid order with resold inventory | Cancel voids the pending intent first; the two claims are mutually exclusive; a settled payment keeps the cancel refused (409) |
| Payment success is server-decided | Already correct (signature + amount + claim); verified independently | Unchanged; webhook rejections now carry the standard envelope with a request id |
| Procurement payout integrity | Payout was claim-atomic and idempotent, but one account could review and pay its own offer | Review and payout refuse the actor's own offer (`SUPER_ADMIN` break-glass only); the parallel-payout race test still passes |
| Wallet ledger | Append-only in code, every balance write paired with a ledger row, reconciliation script exits 1 on mismatch | Unchanged; the script was executed directly (exit 0 clean, exit 1 corrupted) |
| Payment mode truthfulness | The live adapter could route to the sandbox host while reporting `mode: "live"` | Reported mode follows the host; production refuses the combination; `/ready` reports the provider and sandbox flag |
| Upload privacy | EXIF stripped only when the client declared `image/jpeg` | Stripping, extension and stored content type all follow the sniffed bytes |

## 6. AI / agritech quality

- **Corpus and provenance.** 7 hand-written bilingual entries in code, a source
  ledger whose fields are all null/`UNSOURCED`, a whole-corpus hash, and a
  `docs/agronomy-review-sheet.md` that is honest about both the missing licensing and
  the missing expert review (it is also stale about which entries exist). This is the
  single largest limitation on the product's central claim and it is **declared, not
  concealed** — `docs/ai.md` states it and the review sheet lists it as an owner
  decision. AUD-135.
- **Retrieval and grounding.** Weighted keyword rules over the corpus, top-2,
  citations resolved back against the live KB at read time (so a removed entry stops
  appearing in history). Citations point at internal slugs, not documents, because
  there are no documents to point at.
- **Confidence.** A documented heuristic rendered as a coarse band and explicitly
  labelled as not a probability; no empirical calibration exists. No numeric
  probability is shown to a user.
- **Abstention.** Empty and low-confidence retrieval produce explicit
  "insufficient information" answers with an expert-verification note, tested by 47
  abstain and 13 clarify frozen items and proven to fail if the gate is degraded.
- **Evaluation.** 109 frozen items, checksum recorded, pre-registered thresholds,
  artifact committed; all items `synthetic: true, reviewedBy: null`. The suite itself
  says it is threshold-gated and not accuracy-certified — which is the honest
  position.
- **Weather.** Provenance envelope with observed-vs-forecast and fetch time that is
  never invented, unit normalization, Asia/Dhaka day bucketing, failures never cached
  or served stale, single-flight coalescing. One copy defect: the disease-risk
  advisory's own "confirm first" condition is dropped by the UI while its fungicide
  action line is rendered (AUD-114).
- **Disease intake.** Content-verified format, size cap, randomized names, EXIF
  stripped by sniffed bytes, owner-bound to a crop cycle, queued as `PENDING_REVIEW`
  with an explicit do-not-treat message, and a race-safe review transition. No
  classifier exists and none is claimed. Two functional gaps: no reviewer queue
  (AUD-112) and the reviewed result is never shown to the farmer (AUD-113).
- **Spend and latency.** Usage/cost logged with request ids where the provider
  reports tokens; the cost breaker is inert for a provider that omits usage
  (AUD-136). No live provider call was made in this audit.

## 7. Security and privacy

- **Roles and enforcement.** 13 roles from source, a generated route×role matrix
  drift-gated by test, all handlers server-authorized, and cross-user/tenant
  negatives for the money, image, notification and AI-history paths.
- **Auth.** bcrypt cost 12 with a worker pool and transparent upgrade; HS256 with
  pinned algorithm and issuer plus a ≥32-char production guard; opaque rotated
  refresh tokens stored hashed with family revocation on replay; uniform login
  responses and timing; per-account DB lock as the durable control behind the
  per-instance rate limits.
- **Secrets.** gitleaks over full history (CI, green on this SHA); four
  `.gitleaksignore` entries are commit-pinned false positives with waivers and
  expiry; no live credential in the tree; the historically public demo passwords were
  rotated per the deployment runbook. The scanner binary was unavailable locally, so
  the local re-run used pattern scans — recorded as a confidence limiter.
- **Uploads and browser surface.** No `dangerouslySetInnerHTML`, no cookies (so no
  CSRF surface), CSP with hash-pinned scripts on the Vercel edge, explicit CORS
  allow-list, error envelope with no stack traces in production.
- **Dependency alerts (new this run).** GitHub reports 13 open Dependabot alerts on
  the default branch (4 high, 5 medium, 4 low). All 13 are **dev-only transitive**
  paths — `undici` via jsdom, `serialize-javascript`/`fast-uri` via workbox and ajv,
  `postcss-selector-parser` via tailwind, `uuid` via autocannon and the Capacitor CLI
  — which is why the CI gate that audits **production** dependencies is green while
  Dependabot still flags them. None is production-reachable; all four highs have
  same-major patched versions that the consumers' own ranges already allow. AUD-140
  (not fixed here; recipe in Owner Actions).
- **Waivers.** Every Trivy/gitleaks suppression carries an owner, a reason and an
  expiry in `SECURITY_WAIVERS.md`; no new suppression was added by this branch.

## 8. Findings

36 findings, each with evidence, impact, root cause, fix commit, regression test,
independent verification, residual risk and owner decision in `.audit/findings.csv`
and `.audit/findings.json`.

| Severity | Count | Status |
|---|---:|---|
| S0 | 0 | — |
| S1 | 3 | all `VERIFIED_FIXED` |
| S2 | 11 | 4 fixed, 4 deferred to owner, 3 open |
| S3 | 22 | 11 fixed, 9 open, 2 deferred |

Top findings by risk (the full register has the rest):

| ID | Sev | Status | Title | Fix |
|---|---|---|---|---|
| AUD-101 | S1 | FIXED | A cancelled order could still be paid, reselling its released stock | `90a1095` |
| AUD-102 | S1 | FIXED | One account could review and pay out its own procurement offer | `8f0b520`, `de38801` |
| AUD-103 | S1 | FIXED | The live payment adapter reported "live" while able to use the sandbox | `ff2e629` |
| AUD-104 | S2 | FIXED | Upload metadata stripping followed the declared type, not the bytes | `39ab938` |
| AUD-107 | S2 | FIXED | A logout silently discarded queued offline work | `456f6bb` |
| AUD-137 | S2 | FIXED | The migration-drift gate failed on every local re-run | `1b59438` |
| AUD-135 | S2 | DEFERRED | The agricultural knowledge base has no sources | owner |
| AUD-102 residual | S2 | DEFERRED | QC cannot re-measure the grade/moisture that fix the payout | owner |
| AUD-112 / AUD-113 | S2 | OPEN | No reviewer queue; the reviewed diagnosis is never shown | owner |
| AUD-105 | S2 | DEFERRED | Parallel same-key payment intents have no unique backstop | owner/dev |
| AUD-138 | S3 | DEFERRED | Territory roles fail open with no region (ODL-007) | owner |
| AUD-139 | S3 | DEFERRED | Production has no shared rate-limit store (confirmed live: `limiterStore: memory`) | owner |

`OPEN` here means a real, evidence-backed gap that this audit deliberately did not
fix (feature work, a schema migration, or a policy decision), not an unverified
suspicion. Every one names the owner action that would close it.

## 9. User-simulation results

Three environments were used, because one was not enough and saying so is more
useful than picking the flattering one.

### 9.1 Local, at the final SHA `c163de5` (clean tree) — journey acceptance

Freshly provisioned `acceptance.db`, seeded with the repository's synthetic fixtures
(8 products, 8 services, 3 membership plans, 5 role accounts), a real API on :4000
and a real Vite dev server on :5173. `/ready` reported
`{db:true, schema.applied:15, latest:20261024020000_otp_live_challenge_unique,
limiterStore:"memory", storage:{provider:"local",durable:false},
payments:{provider:"sandbox",sandbox:true}}` — the new payments field present at
runtime.

**44 of 44 journey tests pass** across six suites:

| Suite | Flows driven through the real HTTP API + seeded DB |
|---|---|
| `journey-auth` | register → login → session → logout revocation → role boundary |
| `journey-farm` | farm → plot → crop cycle with automatic lifecycle stage and PLANTING event |
| `journey-marketplace` | browse → cart → checkout → sandbox payment → order history |
| `journey-services-procurement` | booking with assignment, procurement submit → QC → PO → collect → payout → wallet credit |
| `journey-weather-ai-disease` | weather provenance, AI advisory with citations, disease upload → expert review |
| `journey-admin` | admin dashboard metrics, role management, non-admin refusal |

### 9.2 CI, at the final SHA, from a clean checkout — browser acceptance

The `web-e2e` job performs exactly the sequence Phase 7 asks for — clean checkout,
`npm ci`, `prisma migrate deploy`, `db seed`, API build and boot, web server, then
Playwright — and it **passed at this SHA**, twice per run (dev server, then the
production build on :4173). 44 test instances per pass: the full chromium suite
(Pixel 5 / 390×844, `bn-BD`) plus the firefox and webkit smoke projects, covering
`farmer-journey`, `gui-e2e-test`, `offline` (queue + replay-exactly-once),
`settings-account`, `admin-guard`, `a11y`, `console-health`, `keyboard`,
`visual-contract`, `english-mode`, `logout-revocation`, `farm-card`, `perf-smoke`
and `splash-verify`.

### 9.3 Local browser attempt — blocked by host I/O, recorded rather than hidden

The same browser suite was also started locally. Two of the lightest a11y specs
passed (`/login` 12.4s, `/login` error state 20.4s, both zero critical/serious
violations). The multi-route authenticated scans then failed on **timeouts, not on
findings**: `Tearing down "context" exceeded the test timeout of 30000ms`, with the
captured page snapshot showing the app rendered correctly (Bangla UI, wallet page,
navigation, skip link, logout — all present). A single axe scan took 2.5–3 minutes
against ~3 seconds in CI. Root cause: this host's disk is at 99% (≈3.7 GB free after
freeing 1.7 GB of superseded browser builds mid-run), so page loads and browser
teardown exceed the configured timeouts. The raw log is preserved verbatim at
`.audit/evidence/local-browser-attempt.log`.

No accessibility violation was ever reported by any attempt; the failures are the
absence of a result, not a bad one. The accessibility claim in this report rests on
CI's run of the same specs at the same SHA.

### 9.4 The fresh-clone install — attempted, blocked, and why that is acceptable

The clone was made and asserted at the exact SHA, and the documented configuration
was written into it. Its `npm ci` stalled for 35 minutes without completing: the
disk hit 100% during the session, and a second full `node_modules` (~1 GB) plus the
install's temporary I/O do not fit. `.audit/scripts/fresh-clone-acceptance.sh`
performs the whole path and is provided to be re-run once disk is available.

This is a *host* limitation, not a reproducibility gap in the repository: CI's
`web-e2e` job performs the identical clean-checkout → install → migrate → seed →
build → serve → Playwright sequence at this SHA and passed, and the local journey
acceptance ran against a deliberately fresh database with synthetic data.

### 9.5 Coverage gaps in the acceptance set

Two paths have no browser spec in the repository: the disease-photo upload journey
and the wallet withdrawal flow. Both are covered by API-level suites (12 disease
upload hardening tests including the new mislabel cases; `wallet-withdrawals` and
`withdrawal-race`), and both appear in §9.1's journeys. Recorded as gaps in the
acceptance set rather than as passes.

## 10. Quality and anti-slop

- **Taxonomy sweep (S-01…S-22).** No placeholder or dead UI, no no-op handlers, no
  `href="#"`, no fabricated metrics, no mock data presented as real, no
  `dangerouslySetInnerHTML`, no stacked `console.log` in shipped source, no
  unused/abandoned dependency additions (knip gate), no duplicated utility trees
  (jscpd 2.5% against a 3% ceiling).
- **Cold-read.** The sampled files read cleanly: purpose clear, no dead branches, no
  narrating comments, error/empty states handled. One file has a comment claiming a
  provider abstraction for disease classification that does not exist
  (`disease/routes.ts`) — recorded as a low finding rather than rewritten, because
  the comment states an intention the schema's unused `AI_ONLY` value corroborates.
- **Test honesty.** Two assertions that asserted nothing were replaced with real
  contracts (AUD-111, AUD-115); one test fixture was corrected to match a new
  invariant; no test was deleted, skipped or weakened, and the lint ratchet (143
  warnings, 0 errors) was held rather than raised — by refactoring the code that
  would have breached it.
- **Claims.** Six documentation claims that had drifted from the code were corrected;
  two README statements are still inaccurate (AUD-118) and are left as an owner
  wording fix.

## 11. CI/CD and release governance

- **Final CI state at `c163de5`:** PR #85 `mergeable: MERGEABLE`,
  `mergeStateStatus: CLEAN`. All required checks green: API (SQLite), API
  (PostgreSQL 17), API migration drift, Web Lint/Unit/Build, Web E2E, Android debug
  APK, Docker build, Compose smoke, Trivy config + image, gitleaks, npm audit,
  CodeQL, ZAP baseline.
- **What CI caught that the local runs did not:** editing `.env.example` without
  re-rendering `docs/env-reference.md` failed `generated-docs-freshness` on both API
  jobs — a derived artefact a local pass had left stale. Fixed by rendering the file
  (`c163de5`).
- **Triggers re-derived** by script, not by reading: a feature-branch push triggers
  nothing; a PR triggers CI, CodeQL and DAST (all inside the runner); `deploy-staging`
  needs a `v*` tag; production deploy follows a push to `main` via Vercel.
- **Deliberately not executed:** no deployment, release, tag, APK/AAB signing, Play
  submission or workflow dispatch. PR preview deployments were created by Vercel's
  existing Git integration (normal PR behaviour, preview environment, not production).
- **Merge decision.** Merging this branch would trigger the production deployment, so
  it is left to the owner under the run's authorizations. Everything needed is in
  place: green required checks, a clean merge state, an evidence bundle, and the one
  configuration check the owner must make first (see §13).

## 12. Limitations and unverified items

| Item | Why | Risk if wrong |
|---|---|---|
| Fresh-clone **install** on this host | Disk at 100% (≈2 GB free); the clone's `npm ci` stalled | The clean-environment install was executed by CI instead; the risk is that a host-specific install issue could go unseen locally |
| PostgreSQL profile locally | No PostgreSQL service and no verified Docker daemon | PG-specific behaviour rests on CI runs plus SQLite-profile tests |
| Container scans (Trivy image, compose smoke) locally | Same | Rest on CI |
| Live AI/provider behaviour | No credentials, and the run must not spend | The fenced-reference prompt hardening is asserted statically and by 51 cases; a hosted model's obedience is untested |
| Agronomic correctness and Bangla quality | Requires a human expert | Cannot be certified by this audit; review sheet pending |
| Backup/restore, rollback and chaos drills (I-07) | Require production-adjacent infrastructure the audit must not touch | Recovery is documented but unexercised |
| Production load profile | No owner-approved SLO exists; only a dated local measurement | No capacity claim is made anywhere in this report |
| Accessibility beyond the automated checks | No assistive-technology pass | WCAG conformance is not claimed; only "zero axe critical/serious on three routes" |
| Whether the rotated demo credentials are unreachable | Requires owner knowledge or a live auth attempt, which the audit will not make | Listed as an owner action |
| `apid`/`undici`-class dependency alerts | Dev-only; fix deferred to avoid a late lockfile change without a verification window | Low: not production-reachable |

## 13. Owner actions

Ordered by risk. The first three are the ones that matter.

1. **Confirm the production payment configuration before merging.** If
   `PAYMENT_PROVIDER=sslcommerz` is set, `SSLCOMMERZ_SANDBOX` must be the literal
   `false`, or the next deployment will refuse to start (by design — AUD-103). If the
   API is intentionally sandbox-only, set `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1`
   knowingly and remove it before any store submission.
2. **Commission the agronomy review.** The knowledge base has no sources and no item
   in the evaluation set has been reviewed by a human. Supply publisher/URL/licence/
   date per entry (or approve re-authoring from official Bangladesh sources) and have
   a Bangladesh agronomist review the corpus and the 109 evaluation items. Until then,
   no agricultural-correctness claim should be made.
3. **Rotate nothing, but confirm nothing needs rotating.** The historically public
   demo passwords were rotated per the deployment runbook; confirm the current values
   are owner-held and that the legacy Render database is gone. (gitleaks is green over
   full history.)
4. **Decide the two policy questions:** may QC re-measure the self-declared grade and
   moisture that fix a procurement payout, and should a territory manager with no
   region see every region's offers (ODL-007 currently fails open)?
5. **Provision a shared rate-limit store** (`REDIS_URL`). Production currently reports
   `limiterStore: memory`, so effective quotas are multiplied by the instance count.
6. **Close the disease loop:** build the reviewer queue and render the reviewed result
   to the farmer, or stop telling users their photo is "queued for agronomist review".
7. **Dependency hygiene:** the 4 high Dependabot alerts are dev-only and all have
   same-major patches the consumers already allow — add npm `overrides` for
   `undici ^8.12.2`, `fast-uri ^3.1.9`, `serialize-javascript ^7.1.3`,
   `postcss-selector-parser ^6.1.5`, regenerate the lockfile, and re-run
   `npm audit` plus the web unit tests and build (the recipe is in AUD-140).
8. **Schedule a migration to give the payment-intent key a unique index**
   (`Payment.clientRequestId` + `@@unique([userId, clientRequestId])` across all three
   schema copies and both chains) — the one money-path gap this audit deliberately
   left open rather than hand-migrate late in a session.
9. **Exercise the operations runbooks** (backup/restore, rollback, provider outage,
   chaos drills) on staging and record the results, which is what unlocks Domain I.
10. **Governance:** consider requiring at least one approving review (currently 0) and
    turning on code-owner review, and add a tag ruleset so a `v*` tag cannot publish
    images before any guard runs.

## 14. Roadmap (30 / 60 / 90 days)

**Next 30 days** — close the loop on what is promised to users: the disease reviewer
queue and the rendered result (AUD-112/113); the two policy decisions in §13.4;
`REDIS_URL`; the dependency overrides; correct the two README statements (AUD-118).

**Days 30–60** — make the safety net self-enforcing: the payment-intent unique index
(AUD-105); request ids on audit rows (AUD-123) and an alert on ledger reconciliation
mismatch (I-06); wire or delete the inert provider bulkhead (AUD-122); include the
payment/storage adapters in the coverage denominator (AUD-132); extend the claims gate
to `docs/STATUS.md` (AUD-134).

**Days 60–90** — raise the ceiling: the sourced knowledge base and the agronomist
review (AUD-135, which is also what unlocks Domain A); the operations drills (I-07);
a
gated load profile with an owner-approved SLO (I-04/I-08); an assistive-technology
accessibility pass (G-06); and, once the corpus is real, retrieval evaluation that can
demonstrate recall against external material rather than authorship.

Dates are deliberately absent: every item above either waits on a human expert, a
policy decision, or infrastructure — none is a scheduling problem.

## 15. Appendices

### Appendix A — Evidence index

- Manifest: `.audit/evidence-manifest.json` — 185 claim entries and 19 hashed
  artifacts, with the environment fingerprint and the SHA each claim was formed at.
- Checksums: `.audit/evidence-checksums.txt` (sha256 per artifact).
- Lint: `.audit/scripts/build-evidence-manifest.py` enforces that every evidence id
  used by the catalog CSVs and by this report exists, that every source path cited by
  a claim exists at the candidate SHA, and that every `.audit` artifact is hashed. It
  currently reports **clean**.
- Raw logs: `.audit/evidence/gates-baseline.log` (full baseline battery),
  `.audit/evidence/gates-final.log` (final battery, stopped when CI superseded it),
  `local-acceptance.log` and `acceptance.log` (the two acceptance attempts).
- The prior audit generation is preserved at `.audit/reports/archive-2026-10-19-v2/`
  and its 350 evidence files remain in `.audit/evidence/` — untouched, and treated
  only as leads (T4).

### Appendix B — Reproduced commands

```
# identity and envelope
git rev-parse HEAD ; git status --short ; git remote -v
gh api repos/tanviruchahs2580/AgroBridge/rulesets            # governance, read-only
gh api "repos/.../dependabot/alerts?state=open"              # alerts, read-only
curl -sS https://agro-bridge-api.vercel.app/ready            # production state, read-only

# gates (see .audit/scripts/run-gates.sh for the full ordered battery)
npm ci --include-workspace-root --no-audit --no-fund
cd apps/api && npx prisma validate && npx prisma generate && npx eslint src tests
npm run typecheck && npx vitest run --coverage
cd ../.. && node scripts/knip-gate.mjs && npx jscpd --silent --threshold 3 apps/api/src apps/web/src
node scripts/licence-gate.mjs && node scripts/drift-check.mjs && node scripts/todo-gate.mjs
node scripts/qa/lint-budget.mjs && node apps/api/scripts/route-matrix.mjs --check
node apps/api/scripts/gen-erd.mjs --check && node scripts/check-versions.mjs
node scripts/qa/link-check.mjs && node scripts/qa/claims-check.mjs
cd apps/web && npm run lint && npm run i18n:check && npm run test:unit -- --coverage
npm run build && npm run preflight && cd ../.. && npm audit --omit=dev --audit-level=moderate

# audit-specific tooling
python .audit/score.py .audit/master-prompt.md .audit/catalog-status.csv
python .audit/scripts/build-catalog.py ; python .audit/scripts/build-findings.py
python .audit/scripts/build-evidence-manifest.py ; python .audit/scripts/resolve-citations.py
python .audit/scripts/classify-triggers.py ; node apps/api/scripts/reconcile-wallet.mjs

# acceptance
bash .audit/scripts/local-acceptance.sh          # executed at the final SHA
bash .audit/scripts/fresh-clone-acceptance.sh    # blocked locally by disk; runs end to end when it is free
```

### Appendix C — Catalog and score files

- `.audit/catalog-status.csv` — 185 rows, `id,status,evidence,notes,check_type,run_sha`.
- `.audit/catalog-status-baseline.csv` — the same catalog with the pre-fix statuses of
  the items this session changed, so both scores come from one catalog version.
- `.audit/score-caps.csv` — all 15 §7.3 conditions, applied or not, with evidence.
- `.audit/score.py` — the Appendix B scorer (rejects an unscored ID, a PASS without
  evidence, or a PARTIAL without an explanation).

### Appendix D — Waivers

No new waiver or suppression was added by this branch. The existing register
(`SECURITY_WAIVERS.md`: 4 gitleaks commit-pinned false positives, 1 Trivy dev-only
advisory, 1 Trivy IaC root-process waiver) is unchanged, and each entry retains an
owner, reason and expiry.

### Appendix E — Dataset and configuration hashes

| Item | Hash / value |
|---|---|
| AI evaluation set | `tests/fixtures/ai-eval/questions.json`, 109 items, sha256 recorded in the harness and in the committed artifact |
| Knowledge base | `KB_VERSION` — a hash of the 7-entry corpus, asserted stable by `ai-versioning.test.ts` |
| Acceptance database | `apps/api/acceptance.db`, built from the repository's synthetic seed; deleted after the run |
| Evidence artifacts | `sha256` per file in `.audit/evidence-checksums.txt` |

### Appendix F — Glossary

**Claim** — a database write whose predicate asserts the expected prior state
(`updateMany({where: {status: X}})`), so exactly one of several contenders wins.
**AUD-nnn** — a finding id from `.audit/findings.csv`. **Catalog id** — one of the 185
weighted checks in the V3 prompt (`A1-01`, `C-04`, …). **Evidence id** — the `E-…`
token attached to a catalog row and resolved by the evidence manifest. **ODL-007** —
the repository's own identifier for the unassigned-territory fail-open.
