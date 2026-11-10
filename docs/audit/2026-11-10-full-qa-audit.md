# AgroBridge — Full QA & Engineering Audit

**Report ID:** AUD-2026-11-10-FULL
**Date:** 2026-11-10
**Audited revision:** local `main` @ `84cf9c0` (`docs: the release record — production at 3f1c991 (#91)`)
**Divergence:** `origin/main` is **1 commit ahead** — `d205f76` (`docs: make the release record's artifact claim exact (#92)`). The working tree is **not** the deployed revision; every "live" statement below refers to `d205f76`.
**Scope:** whole repository — `apps/api`, `apps/web`, `apps/api/prisma`, `scripts`, `.github/workflows`, `docker`, `monitoring`, `contracts`, `docs/**`, root hygiene.
**Mode:** read-only. **No file was modified, created or deleted by this audit, and no fix was applied.** All `git status` deltas observed pre-dated the audit (`M docker-compose.yml`, `M docker-compose.prod.yml`, `?? AGENTS.md`).

**Status of this document:** it supersedes nothing. It is a *new, dated, scoped* verdict. The repository currently also carries `docs/audit/2026-10-29-agrobridge-enterprise-audit.md` (`COMPLETE`, 83.78/100) and `docs/audit/AUDIT-REPORT-20261030.md` (`INCOMPLETE — FAIL`, 95.07/100) — two mutually contradictory verdicts on the same directory (finding **F-21**). Do not treat any of the three as authoritative until they are reconciled; see §10, Open Decision **OD-01**.

---

## 1. Executive summary

### 1.1 Verdict

**Score: 74 / 100 — Band: Conditional (C+)**

> **Production-viable for a controlled pilot; not release-ready for open live payments, and not ready for a Play Store public launch.**

The engineering core of this system is genuinely strong and, unusually, its own gates are real: coverage thresholds are enforced on both apps, the API runs against **both** SQLite and PostgreSQL in CI, migration chains are content-diffed against the shipping schema, a 13-role permission table is drift-gated, money is integer paisa *everywhere*, and the atomic-claim patterns on the money path are correct. I tried to break the money path and could not find a double-spend. Eight load-bearing "this is safe" claims in the source were checked against the code and **all eight are true, several stricter than the comment claims**.

What holds the score down is not the code. It is:

1. **Four P1 defects on the money path** — withdrawal creation has no idempotency of any kind; the live SSLCommerz webhook destroys the client idempotency key the sandbox path carefully preserves; concurrent same-key payment-intent creation has no database backstop; and the gateway return URLs are built without the `/api/v1` mount prefix, so a buyer returning from hosted checkout lands on a 404.
2. **An authorisation gap that a read-only role can exploit** — an organisation `VIEWER` (a role that exists precisely to be read-only) can rename and **delete another member's farm**, cascading away plots, crop cycles and farm-event history.
3. **A live prompt-injection hole on the hosted AI path** — user-supplied `cropName` is interpolated raw into the *system* message, above the untrusted-reference fence, while only the user turn is sanitised.
4. **A compliance misstatement in a tracked legal document** — the privacy policy says data is hosted in "Bangladesh/Singapore"; the runtime contract and production headers say API functions execute in `iad1` (US East) and no region is pinned in either `vercel.json`.
5. **A verification layer that does not hold its own weight** — 13 of 26 declared permissions are enforced by no route and 6 modules authorise with 19 inline role-list checks; 5 CI jobs including the migration-drift gate are **not** required status checks; the documented pre-push duplication gate **fails deterministically**; ~30 tracked-document references point into an untracked `.audit/**` tree; and the branch-protection statement in the "truth page" is factually inverted.

Add to that a large **documentation-integrity debt**: the docs are the review artefact for an AI-authored codebase (169 of 219 commits are from `AgroBridge Builder`), and measured mechanically, **64 of 91 symbol citations in the 10 core documents do not contain the symbol they claim** (70%). The documentation *looks* rigorous — which is the worst possible failure mode for documentation.

### 1.2 Severity ledger

| Severity | Count | Definition used |
|---|---|---|
| **P0 — Critical** | **0** | Breaks production today, or is an active data/security breach in the *deployed* configuration. |
| **P1 — High** | **22** | Blocks the next release milestone, is a live money/authorisation/legal defect, or makes a safety claim unverifiable. |
| **P2 — Medium** | **43** | Real defect or drift with bounded impact; should be fixed before scaling beyond a controlled pilot. |
| **P3 — Low** | **36** | Polish, dead code, cosmetic drift, cheap wins. |
| **Total** | **101** | |

**No P0 was found.** Under my definition nothing found breaks the *currently deployed* configuration (Vercel + Neon, sandbox payments, offline AI engine, SQLite-free production). The four money-path P1s become P0s the moment live SSLCommerz payments are enabled — that sequencing is the single most important operational fact in this report.

**Note on a rating disagreement:** the architecture reviewer rated the evidence-layer defect (**F-21**) as P0 on a governance rubric. I have re-rated it **P1** because it has no user-facing or data-integrity impact, while marking it the **top process priority**. The disagreement is recorded rather than hidden.

### 1.3 Score computation (transparent)

Domain scores are the independent specialists' verdicts; the overall is their weighted mean adjusted by one documented cap/penalty.

| Domain | Weight | Score | Weighted |
|---|---|---|---|
| Security & money-path correctness | 20% | 78 | 15.60 |
| API / backend quality | 15% | 74 | 11.10 |
| Data layer (schema, migrations, integrity) | 12% | 78 | 9.36 |
| Frontend / UX / PWA | 12% | 78 | 9.36 |
| AI subsystem | 10% | 70 | 7.00 |
| QA & verification integrity | 15% | 78 | 11.70 |
| DevOps / release readiness | 10% | 72 | 7.20 |
| Architecture & documentation integrity | 6% | 62 | 3.72 |
| **Weighted mean** | **100%** | | **75.04** |
| Adjustment — verifiability penalty (F-21, F-46, F-79 class: the repo cannot verify its own strongest claims, its link gate cannot see the class, and two tracked audits contradict each other) | | −1.04 | |
| **Final** | | | **74 / 100** |

### 1.4 AI-slop assessment

**AI-slop score: 76 / 100** (100 = pristine hand-engineered, 0 = pure slop).

Counter-intuitively, **the source code is not the slop**. Measured across 11 scans:

| Axis | Result |
|---|---|
| Comment density (n=324 files) | median **19.1%** — healthy; content explains *why* with measured numbers and audit IDs |
| Comments that merely restate the next line | **13** in the entire tree |
| `// Step N` / sequential markers | **0** |
| `TODO` / `FIXME` / `HACK` | **0** (`scripts/todo-gate.mjs` enforces) |
| `@ts-ignore` | **0**; `@ts-expect-error` **1** (with reason) |
| `eslint-disable` | **10**, every one carrying a justification |
| Generic identifiers (`data2`, `doWork`, `result1`, `V2`, `legacy`) | **0** |
| Duplication clusters (Zod schemas, pagination, error strings, response envelopes, React list screens) | **none found** — all centralised |
| Emoji in UI | deliberately removed, with the reasoning recorded in-source |

The slop is concentrated in four **peripheral** places: repo-root entropy (~167 MB of untriaged agent artefacts, 26 SQLite DBs, 4 debug APKs), the `docs/generated/` directory (a fabricated design document prescribing `@tanstack/react-query` — a library `AGENTS.md` §4 forbids and which is not installed), an unfinished refactor (six 2-line `lib/*` re-export shims with the same typo stamped into all six, 68 call sites on one path and 3 on the other), and **broken/dead verification** (`npm run qa:knip` cannot run at all; a provider-health registry is written to by the AI gateway and read by nobody).

See §8 for the full slop assessment and the ranked top-10 instances.

---

## 2. Method, environment, and evidence discipline

### 2.1 How this audit was produced

Nine independent workstreams ran in parallel (security, database, API, frontend, AI, QA, DevOps, architecture/documentation, AI-slop), each read-only, each required to cite `file:line` and quote the code. Their headline P1 findings were then **independently re-verified by the lead auditor** before publication — see §2.4. Disagreements and re-ratings are recorded in place.

### 2.2 Environment — read this before trusting any number

| Fact | Value | Consequence |
|---|---|---|
| Ambient Node | **v24.19.0** | The project pins **Node 22** (`.nvmrc` = `22`, `engines.node` = `>=22`). No `nvm`/`fnm`/`volta` on this machine, so Node 22 could not be selected. **Per `AGENTS.md` §2, every executed result in this report is non-transferable to CI.** |
| npm | 11.17.0 | CI installs Node 22, whose bundled npm is 10.x — a different `allow-scripts` surface (F-77) |
| Database | SQLite local; **no `psql`, no `sqlite3`, no `docker exec`** used | No PostgreSQL-specific behaviour was executed locally. All PG claims are from CI logs or reading |
| Android | **no `java`, no `gradle`, no `adb`** | Any claim that the Android app launches or the APK installs is **unverifiable from this environment** (`AGENTS.md` §10) |
| Browser | no dev server started, no page rendered | Frontend findings are source-verified or based on **recorded** Lighthouse artefacts from 2026-10-30. The `dist/` bundle measured is from `d28a243`, **7 days before HEAD** |

### 2.3 Evidence taxonomy used throughout

- **VERIFIED-BY-RUNNING** — a command was executed and its real output is quoted.
- **VERIFIED-BY-READING** — both sides of a claim were read and quoted; no execution.
- **REPORTED-BY-TOOLING** — CI/job logs or a committed artefact, not reproduced here.
- **NOT DETERMINED** — explicitly unresolved; never silently omitted.

### 2.4 Lead-auditor re-verification of headline P1s

Each item below was checked first-hand by the lead auditor (not accepted from a specialist agent):

| Claim | Method | Result |
|---|---|---|
| Withdrawal creation has no idempotency | read `payments/routes.ts:827` | **CONFIRMED** — `walletRouter.post("/withdrawals", financialLimiter, validate({body}), …)`; no idempotency middleware, no key column |
| Webhook overwrites `metaStr`, destroying the client key | read `payments/webhook.ts:88-95` vs `payments/routes.ts:366-382` | **CONFIRMED** — webhook writes `metaStr: JSON.stringify({ mode, valId, verified })`; `claimAndApplyPayment` deliberately merges `{ ...meta, idempotencyKey: clientKey }` with a comment explaining why the key must survive |
| SSLCommerz return URLs omit `/api/v1` | read `providers/payment/sslcommerz.ts:95-97` + `env.ts:20` + `docs/env-reference.md:15` + `app.ts:148` | **CONFIRMED** — `${returnBaseUrl}/payments/gateway/return/success`; `API_PUBLIC_URL` documented as "no trailing `/api/v1`"; route mounted under `/api/v1` |
| Org `VIEWER` can delete another member's farm | read `farms/routes.ts:37-51,128-136` + `organizations/routes.ts:72` | **CONFIRMED** — `assertFarmAccess` finds the membership row and never reads `member.role`; `DELETE /farms/:id` proceeds unconditionally |
| `cropName` reaches the system prompt unsanitised | read `openai-compat.ts:60-75` + `aiagent/routes.ts:45-50,78-86` | **CONFIRMED** — `ctx.cropName` interpolated into the system array; `.trim().max(80)` permits newlines; only the user turn passes `sanitizeQuestion` |
| Offline-queue ownership guard is dead in production | grep `setSession` callers across `apps/web/src` | **CONFIRMED** — the only callers are `offlineQueue.test.ts`; `getSession()?.userId ?? ""` is therefore always `""`, so `if (entry.ownerId && …)` never fires |
| Documented `npm run qa:jscpd` gate fails | ran it | **CONFIRMED** — `Found 109 clones … 1984 (3.42%) … ERROR: jscpd found too many duplicates (3.4%) over threshold (3.0%)` |
| Privacy policy misstates the hosting region | read `PRIVACY_POLICY.md:148` vs `docs/runtime-contract.md:23-32`, both `vercel.json` | **CONFIRMED** — policy says "Bangladesh/Singapore region"; runtime contract says API executes in `iad1`; no `regions` block configured anywhere |
| `main` is unprotected (as `STATUS.md:101` claims) | `gh api …/rulesets` | **REFUTED — the doc is wrong.** Ruleset `25297401` `main — protected`, `enforcement: active`, 11 required status checks, `required_approving_review_count: 0` |
| Migration-drift gate is a required check | `gh api …/rulesets/25297401 --jq` | **REFUTED — it is not required.** 11 contexts confirmed; `API — Migration chain vs schema (PostgreSQL 17)` and `Quality gates — knip / jscpd / licences / commitlint / migration drift` are absent |

Of ten headline claims tested, **eight confirmed and two refuted in the repository's favour** (the branch-protection doc understates the control; the migration-drift gate is weaker than `AGENTS.md` §6 asserts). Both refutations are reported as findings.

---

## 3. Gate execution — real results

### 3.1 Gates executed by the lead auditor

| Gate | Command | Real result | Status |
|---|---|---|---|
| Typecheck (both workspaces) | `npm run typecheck` | exit 0, no diagnostics (Node 24) | **PASS** |
| Web unit tests | `npm run test:unit --workspace apps/web` | `Test Files 27 passed (27)` / `Tests 214 passed (214)`, 180.79s | **PASS** |
| API tests (SQLite) — run 1 | `npm run test --workspace apps/api` | `Test Files 15 failed | 95 passed (110)`, `Tests 50 failed | 540 passed | 1 skipped (591)` — root cause `The table main.User does not exist` | **INVALID — environmental collision, see §3.3** |
| API tests (SQLite) — run 2 (isolated) | `npm run test --workspace apps/api` | `Test Files 110 passed (110)`, `Tests 590 passed | 1 skipped (591)`, 554.82s, exit 0 | **PASS** (§3.4) |
| Duplication — documented gate | `npm run qa:jscpd` | `Found 109 clones … 1984 (3.42%)` → `ERROR: jscpd found too many duplicates (3.4%) over threshold (3.0%)` | **FAIL** |
| Duplication — CI scope | `npx jscpd --silent --threshold 3 apps/api/src apps/web/src` | `37 exact clones with 530 (1.97%)` | PASS |
| Licence gate (CI script) | `node scripts/licence-gate.mjs` | `OK — 160 production packages` | PASS |
| Licence gate (documented) | `npm run qa:licenses` | `clean: 171 production packages` | PASS (different gate — F-16) |
| versionCode | `npm run qa:versioncode` | clean (`14001 > 14000`) | PASS |
| Docs link check | `node scripts/qa/link-check.mjs` | `clean (48 relative targets resolved)` | PASS (but unsound — F-46) |
| Docs claims check | `node scripts/qa/claims-check.mjs` | `clean` | PASS (scope-limited — F-64) |
| TODO/FIXME gate | `node scripts/todo-gate.mjs` | `OK` | PASS |
| Version consistency | `node scripts/check-versions.mjs` | `1.4.1 (versionCode 14001)` consistent across 4 manifests | PASS |
| Lint warning budget | `node scripts/qa/lint-budget.mjs` | `api errors=0 warnings=143 (budget 143)`, `web errors=0 warnings=0 (budget 0)` | PASS — **zero headroom** |
| Migration drift (SQLite) | `node scripts/drift-check.mjs` | `no schema drift` | PASS |
| Dead-code gate | `node scripts/knip-gate.mjs` | `RangeError: Array buffer allocation failed` (oxc-parser), 0-byte output | **CANNOT RUN** (F-66) |
| Android build | — | no `java`/`gradle`/`adb` on this machine | **NOT DETERMINED** |

### 3.2 Gates reported by CI (not reproduced here)

From `gh` job logs on the latest green `main` run (2026-11-03, commit for #92):

| Job | Reported result |
|---|---|
| API — Lint · TypeCheck · Tests (SQLite) | `Test Files 110 passed (110)`, `Tests 590 passed | 1 skipped`; coverage `statements 84.36 / branches 73.70 / functions 87.44 / lines 86.82` — **coverage gate IS enforced** (`vitest run --coverage`) |
| API — Integration & Concurrency (PostgreSQL 17) | `588 passed | 3 skipped` |
| Web — Lint · Unit · Build | `214 passed`; coverage `43.36 / 33.21 / 39.97 / 44.91` |
| Web — E2E (Playwright) | pass 1 `94 passed + 2 skipped`; pass 2 `95 passed + 1 skipped`; 96 collected / 21 files |
| Others (migration drift, quality gates, Android APK, Docker, compose smoke, Trivy, IaC, gitleaks, npm audit, CodeQL, ZAP, deploy-verify) | 19/19 checks green on PR #90 |

**Historical red:** run `41094102839` (2026-10-30, #88 merge) concluded **failure** before #89/#90 re-greened main.

### 3.3 The API-suite collision — a first-hand reproduction of finding F-30

My first API-suite run **failed 50 tests across 15 files**, every failure traced to `The table main.User does not exist in the current database` — i.e. the test database was destroyed underneath a running suite. Cause, established by process inspection: a concurrent `vitest run` was in flight (`npx vitest run --no-file-parallelism --sequence.shuffle --sequence.seed=20261030`, PID 27592, started 19:15:54), and `apps/api/tests/global-setup.ts` **unconditionally deletes `apps/api/prisma/test.db` before consulting `DATABASE_URL`**, with no lock.

**This is not a product defect — it is a defect in the test harness, and I reproduced it live.** It means:
- `fileParallelism: false` only orders files *within* one run; two runs on one checkout corrupt each other.
- Any developer (or agent) running a single file while a suite runs gets unattributable failures — exactly the class of confusion that produces "flaky test" folklore.
- A second, isolated run was executed to obtain a defensible number; its result is recorded below and in §3.4.

> **Note on the historical record:** the CI-reported `590 passed / 1 skipped` and my isolated local result are the two numbers that matter. The 50 failures are an artefact and must not be quoted as a regression.

### 3.4 Isolated re-run result

**Command:** `npm run test --workspace apps/api` (no competing run active; full log captured)

**Result: PASS**
```
Test Files  110 passed (110)
     Tests  590 passed | 1 skipped (591)
  Duration  554.82s
EXIT_CODE=0
```

This closes the only open question in §3.1. The suite is green locally on Node 24 as well as in CI, and it reproduces CI's `590 passed / 1 skipped / 110 files` **exactly**. Two corroborating details worth recording:

- The single skip is `tests/concurrency.test.ts (3 tests | 1 skipped)` — the by-design `it.skipIf(!isPostgres)` case (SQLite cannot do row locking), exactly as the suite documents.
- The only `FAIL` strings in the log are the **intentional** degradation-gate output from `ai-eval-degradation.test.ts` (`Gate: FAIL (4 breach(es))` twice, for the injected empty and single-entry corpora). Those are the proof that the eval gate can fail — see §7.5.

**Therefore the collision in §3.3 is confirmed as a test-harness defect (F-30), not a product regression.** The 50 failures must not be quoted as a regression. The contrast is also a useful data point for F-30's impact: the same suite took **554.82 s** when run alone versus **1528.99 s** when competing — a 2.8× slowdown that any developer would attribute to their own change.

### 3.5 Ratchet status

| Ratchet | Floor | Measured | Margin | Status |
|---|---|---|---|---|
| API statements | 82 | 84.36 | +2.36 | HOLDS (upwards) |
| API branches | 72 | 73.70 | **+1.70** | HOLDS — thinnest ratchet in the repo |
| API functions | 84 | 87.44 | +3.44 | HOLDS |
| API lines | 84 | 86.82 | +2.82 | HOLDS |
| Web statements / branches / functions / lines | 40 / 30 / 36 / 42 | 43.36 / 33.21 / 39.97 / 44.91 | +2.9 … +4.0 | HOLDS |
| Lint warnings | api 143 / web 0 | 143 / 0 | **0 / 0** | HOLDS — **saturated; any new warning fails CI** |
| Duplication | 3% | 1.97% (CI scope) / **3.42% (documented scope)** | — | CI holds; documented gate **FAILS** |
| Licence allow-list | 2 files | 160 / 171 packages clean | — | HOLDS but divergent |
| versionCode monotonic | > newest tag | +1 | — | HOLDS |

**No floor was lowered, skipped, or annotated away anywhere.** Every floor is exceeded. That is a genuine strength and it is the reason the overall score is not in the 50s.

### 3.6 Live production probes (read-only GETs)

| Probe | Result |
|---|---|
| `https://agro-bridge-api.vercel.app/api/v1/…/health` | 200, `commit d205f76`, `env production` |
| `https://agro-bridge-api-vantiq-systems.vercel.app/…` | 200, same commit — the two documented hostnames are aliases of one project (F-78) |
| `/ready` | `db: true`, `schema.applied 11`, `latest 20261024020000_otp_live_challenge_unique`, `storage db/durable`, `limiterStore memory` |
| anonymous `GET /metrics` | **403** — the metrics guard fails closed in production (verified, not assumed) |

`/ready` reporting `limiterStore: memory` and `schema.latest` matching the newest repo migration are both correct and honest. `/ready` also **publishes `payments.sandbox` and `storage.durable` to unauthenticated callers** — free reconnaissance (F-40).

---

## 4. Findings — P1 (High)

*22 findings. These block the next milestone: open live payments, or a public Play launch.*

### Money path

#### F-01 · P1 · Withdrawal creation has no idempotency mechanism of any kind
**Domain:** API / money · **Confidence:** VERIFIED-BY-READING (lead auditor)
**Files:** `apps/api/src/modules/payments/routes.ts:827`; `apps/api/prisma/schema.prisma` (`model Withdrawal`)

**Evidence:**
```ts
walletRouter.post("/withdrawals", financialLimiter, validate({ body: withdrawalSchema }), async (req, res, next) => {
```
No `acceptIdempotencyKeyHeader`, no `clientRequestId`, and no key column on `Withdrawal`. The `withdrawalSchema` accepts only `amountPaisa` and `channel`.

**Impact:** `~/.zcode/skills/money-idempotency-integrity` states that checkout, payment initiation, refund, **withdrawal** and payout all go through the idempotency middleware. Withdrawal is the only one that does not. A withdraw request whose response is lost — including an **offline-queue replay**, which is the exact scenario `apps/web/src/lib/offlineQueue.ts` exists for — creates a second withdrawal. Finance approving both rows (`admin/routes.ts:229-259`) pays real money twice. The only guard is the `balancePaisa − heldPaisa` check, which bounds the duplicate at the available balance rather than preventing it. `tests/withdrawal-race.test.ts` proves the *balance* race, not submission idempotency, and no test sends a key on this route. The web client cannot opt in even if it wanted to.

**Fix direction:** add the `Idempotency-Key` header contract plus a unique `(userId, clientRequestId)` on `Withdrawal`, mirroring checkout. Schema change must be mirrored across all three schema copies and both migration chains. Wire the web withdraw handler to send a key.

---

#### F-02 · P1 · The confirming webhook overwrites `metaStr` and destroys the client idempotency key
**Domain:** API / money · **Confidence:** VERIFIED-BY-READING (lead auditor)
**Files:** `apps/api/src/modules/payments/webhook.ts:88-95` vs `apps/api/src/modules/payments/routes.ts:366-382`

**Evidence — the sandbox/confirm path deliberately preserves the key:**
```ts
// routes.ts — claimAndApplyPayment
// A client idempotency key (when one was supplied) rides in metaStr and
// must survive confirmation: a client retrying intent creation after a
// lost response still has to find THIS payment once it is no longer
// PENDING, and metaStr is the key's only column.
const clientKey = idempotencyKeyOfMeta(before?.metaStr ?? null);
data: { status: "SUCCEEDED", metaStr: JSON.stringify(clientKey ? { ...meta, idempotencyKey: clientKey } : meta) },
```
**Evidence — the live webhook does the opposite:**
```ts
// webhook.ts
data: { status: "SUCCEEDED", metaStr: JSON.stringify({ mode: "sslcommerz", valId, verified: true }) },
```

**Impact:** the webhook is the **only** success path for real money. Because it replaces `metaStr`, the key is gone: a client retrying `POST /payments/intent` with the same key finds no replay. For `MEMBERSHIP` — which has no payable-state guard (`routes.ts:259-263`) — that creates a **second payable intent**, which is precisely the double-charge the key exists to prevent. `docs/business-rules.md` BR-36 claims "the single gate shared by sandbox confirm, webhook and status reconciliation", which is not what the code does. Test gap: `tests/idempotency-key.test.ts:185-212` pins key survival only through the sandbox confirm path; nothing asserts it through the webhook.

**Fix direction:** call `claimAndApplyPayment` from the webhook, or extract the `metaStr` merge into one shared helper so all three paths preserve the key. Add a webhook-path key-survival test.

---

#### F-03 · P1 · Concurrent same-key payment-intent creation has no database backstop and can create two payable intents
**Domain:** API / money · **Confidence:** VERIFIED-BY-READING (mechanism); race not reproduced
**Files:** `apps/api/src/modules/payments/routes.ts:298-308`; `apps/api/prisma/schema.prisma` (`model Payment`)

**Evidence:**
```ts
const { payment, replayed } = await prisma.$transaction(async (tx) => {
  if (clientKey) {
    const existing = await findPaymentByClientKey(tx, userId, clientKey);
    if (existing) return { payment: existing, replayed: true };
  }
```
The comment asserts *"two same-key requests that both passed the fast path must still produce exactly ONE payment."* They can. The transaction runs at PostgreSQL's default READ COMMITTED, the candidate lookup is an unlocked `findMany` on `metaStr: { contains: fragment }`, and `Payment` has **no key column and no unique index** — the key lives only inside a text blob. Two requests arriving before either commits both see nothing and both `create`.

**Impact:** two live intents, two gateway sessions, same key. If the gateway collects both, the loser hits `PAYMENT_NOT_PAYABLE` and needs a manual refund. Checkout already solves this properly with `@@unique([userId, clientRequestId])` (`schema.prisma:272`). SQLite (local and the default CI profile) serialises writers, so the defect is invisible except on PostgreSQL — and **no test sends a keyed intent concurrently**; `tests/idempotency-key.test.ts` is entirely sequential.

**Fix direction:** add a real key column + `@@unique([userId, intentKey])` to `Payment` in all three schema copies and both chains, or take a row lock / use Serializable for the keyed path. Add a parallel same-key test to the **PostgreSQL** profile.

---

#### F-04 · P1 · SSLCommerz return URLs are built without the `/api/v1` mount prefix — the buyer lands on a 404 after paying
**Domain:** API / money · **Confidence:** VERIFIED-BY-READING (lead auditor)
**Files:** `apps/api/src/providers/payment/sslcommerz.ts:95-97`; `apps/api/src/modules/payments/routes.ts:110-117`; `apps/api/src/config/env.ts:20`; `apps/api/src/app.ts:148`

**Evidence:**
```ts
success_url: `${input.returnBaseUrl}/payments/gateway/return/success`,
fail_url: `${input.returnBaseUrl}/payments/gateway/return/fail`,
cancel_url: `${input.returnBaseUrl}/payments/gateway/return/cancel`,
```
`returnBaseUrl` comes from `apiPublicBaseUrl(req)`, which returns `env.API_PUBLIC_URL` or `${req.protocol}://${req.get("host")}`. `API_PUBLIC_URL` is documented in three places as *"Public base URL of THIS API (**no trailing `/api/v1`**)"* — `env.ts:20`, `.env.example:13,129`, `docs/env-reference.md:15`. But the route exists only at `/api/v1/payments/gateway/return/:outcome` (`app.ts:148` + `webhook.ts:134`; `tests/round10-regressions.test.ts:218` probes exactly that path).

**Impact:** with the documented configuration the buyer returning from hosted checkout hits `https://api…/payments/gateway/return/success` → `notFoundHandler` → a **JSON 404 instead of the 303 back to the web app**. The failure is silent for the order (the IPN still confirms) and loud only for the buyer, who has just been charged. No test exercises `createPayment`'s outbound form, so CI cannot catch it.

**Fix direction:** append `/api/v1` once inside `apiPublicBaseUrl`, or redefine `API_PUBLIC_URL` as including the prefix and update all three doc sites in the same change. Cover the outbound form with a stubbed-fetch test.

---

#### F-05 · P1 · The gateway session request omits `notify_url` and the required v4 customer/product fields
**Domain:** API / money · **Confidence:** INFERRED (gateway contract not executed — no credentials, no outbound calls)
**Files:** `apps/api/src/providers/payment/sslcommerz.ts:89-102`

**Evidence:** the session body contains only `store_id, store_passwd, total_amount, currency, tran_id, success_url, fail_url, cancel_url, cus_phone, product_category, shipping_method, num_of_item`. There is no `notify_url` (the IPN target), and no `cus_name` / `cus_add1` / `cus_city` / `cus_country` / `product_name` / `product_profile`.

**Impact:** SSLCommerz v4 expects these for a session and may answer `{"status":"FAILED"}` with no `GatewayPageURL`, which `createPayment` converts into `throw new Error("SSLCommerz unexpected response …")` (`:138`) and then `paymentGatewayUnavailable` — i.e. **live payments may be impossible until the fields are added**. The repo documents the MD5 signature scheme as an accepted waiver but says nothing about these fields.

**Honest limitation:** I could not verify the gateway's actual behaviour. This is rated P1 because the blast radius is "revenue path does not work" and the cost of a sandbox rehearsal is low — not because it is proven broken.

**Fix direction:** run one sandbox rehearsal against the real gateway before enabling live mode; add `notify_url` and the required customer/product fields; cover with a stubbed-fetch test.

---

### AI & safety

#### F-07 · P1 · User-controlled `cropName` is interpolated raw into the hosted **system** prompt — a sanitiser bypass
**Domain:** AI / prompt safety · **Confidence:** VERIFIED-BY-READING (lead auditor)
**Files:** `apps/api/src/providers/ai/openai-compat.ts:60-75`; `apps/api/src/modules/aiagent/routes.ts:45-50,78-86`

**Evidence — the value is user-controllable and reaches the instruction region:**
```ts
// routes.ts
cropName: z.string().trim().max(80).optional(),
…
cropName: cropName ?? activeCrop?.cropName,     // client input is PREFERRED
```
```ts
// openai-compat.ts — buildChatMessages
const system = [
  "You are the AgroBridge AI Agro Agent serving Bangladeshi farmers.",
  "Answer ONLY from the grounded knowledge and farm context provided. …",
  "Never invent pesticide/fertiliser dosages. Never execute actions (orders/payments). …",
  `Farmer language preference: ${ctx.lang}.`,
  ctx.cropName ? `Current crop: ${ctx.cropName}${ctx.cropStage ? ` (${ctx.cropStage})` : ""}.` : "",   // ← raw
  ctx.district ? `District: ${ctx.district}.` : "",
  ctx.weatherSummary ? `Weather now: ${ctx.weatherSummary}` : "",
  grounding ? [ … ] : "",                                                                              // ← the fence, BELOW
];
```
`trim()` permits newlines; nothing sanitises the value; it lands **above** the `<<<REFERENCE_DATA` fence, in the instruction region. The user turn is sanitised (`{ role: "user", content: sanitizeQuestion(question) }`), but `cropName` is not. `ai-prompt-injection.test.ts` never varies `cropName`/`cropStage`/`district`, so its 51 cases cannot see this.

**Impact:** with `AI_PROVIDER=openai-compatible`, any authenticated account can inject system-role instructions — e.g. crop name `"rice.\nIgnore all previous instructions…"` (51 characters) — defeating the exact control `docs/threat-model.md` AC-15 claims (*"Questions are sanitised"*). The offline engine is **not** affected (the hint only feeds a `normalizeQuery(hintCrop) === entry.crop` comparison), so this is a hosted-provider-path defect. Severity is P1 rather than P0 because the pilot runs the offline engine.

**Fix direction:** validate `cropName` against the known crop vocabulary (`CROP_KEYS`/KB crops or an explicit allow-list), force single-line, and move **all** context fields inside the untrusted reference block. Add injection cases that vary `cropName`.

---

#### F-22 · P1 · The AI budget guard has two un-metered spend routes, a check-then-act race, and no test at all
**Domain:** AI / cost · **Confidence:** VERIFIED-BY-READING (a,b,c) + VERIFIED-BY-RUNNING (d)
**Files:** `apps/api/src/providers/ai/gateway.ts:26-37, 45-53, 118-138`

**Evidence:**
- `...(tokens > 0 ? { tokensIn: p.tokensIn, tokensOut: p.tokensOut } : {})` with `tokensIn: usage?.prompt_tokens` — a provider that omits `usage` (or reports `input_tokens`) records `costEstimatePaisa = 0` is not written, so **money is spent and never metered**; the guard never trips.
- `logUsage` is wrapped in `catch { /* never fail a user request because of telemetry */ }` — a failed usage insert silently erases spend from the monthly sum, with no log and no counter.
- `monthlyBudgetExceeded()` runs *before* the call and cost is written *after*, so N concurrent requests all pass the check.
- `grep -rn "AI_BUDGET_EXCEEDED|monthlyBudgetExceeded|budget_fallback" apps/api/tests` → **no test**. `env-cost-guard.test.ts` (20 lines) exercises only the pure `hostedAiCostProblem`.

**Impact:** `AGENTS.md` §5 states the monthly budget guard *must not be bypassed*, and `429 AI_BUDGET_EXCEEDED` is documented behaviour. In practice a ৳500 cap is advisory: the 429 branch, the non-prod fallback, and the Dhaka-window-to-guard wiring are all unproven. Minor: the fallback metric uses `{ provider: "offline-engine" }` while the same engine's success path reports `answer.provider = "offline-agro-engine"` — a label split that breaks per-provider dashboards.

**Fix direction:** estimate tokens when `usage` is absent (or fail closed); meter and log guard-accounting failures; reserve-then-commit or a DB-conditional admission for concurrency; add tests for the 429 branch, the fallback branch and the Dhaka month boundary. Unify the provider label.

---

### Authorisation

#### F-06 · P1 · An organisation `VIEWER` — the read-only role — can rename and delete another member's farm
**Domain:** AuthZ / tenant isolation · **Confidence:** VERIFIED-BY-READING (lead auditor)
**Files:** `apps/api/src/modules/farms/routes.ts:37-51` (used by `:114-126`, `:128-136`, `:148-216`, `:284-388`); `apps/api/src/modules/organizations/routes.ts:72`; `apps/api/prisma/schema.prisma:113,154`

**Evidence:**
```ts
/** Ownership + tenant check: owner, privileged, or org member may access. */
async function assertFarmAccess(farmId: string, userId: string, role: string) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  if (!farm) throw notFound("Farm");
  const isPrivileged = role === "SUPER_ADMIN" || role === "ADMIN";
  if (farm.ownerId === userId || isPrivileged) return farm;
  if (farm.organizationId) {
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: farm.organizationId, userId } });
    if (member) return farm;
  }
  throw notFound("Farm");
}
```
The membership row's `role` is **never read**. The invite contract is `role: z.enum(["ADMIN","MEMBER","VIEWER"]).default("MEMBER")`. `DELETE /farms/:id` calls `assertFarmAccess` and then deletes unconditionally; both `prisma/schema.prisma:113` and `:154` cascade plot, crop-cycle and farm-event deletion from `Farm`.

**Exploit sketch:** an org admin invites a farmer as `VIEWER` (the intended read-only role for aggregating member farm data) → that user calls `DELETE /api/v1/farms/<orgFarmId>` or `PATCH /api/v1/farms/<orgFarmId>`. Both pass. Destroys "the digital record" the product advertises.

**Test gap:** `apps/api/tests/tenant-isolation.test.ts` asserts cross-tenant **reads** only; the string `VIEWER` appears **nowhere** in `apps/api/tests`.

**Fix direction:** make the predicate role-aware (`VIEWER` read-only; `MEMBER` writes; `ADMIN` destructive) or gate farm mutations with a declared permission. Add negative tests for VIEWER/MEMBER on PATCH/DELETE.

---

#### F-08 · P1 · The authorisation inventory under-reports the real model: 19 inline role checks, 13/26 permissions unenforced, two roles inert
**Domain:** AuthZ / governance · **Confidence:** VERIFIED-BY-READING (set difference reproduced by script)
**Files:** `apps/api/src/middleware/rbac.ts:11-39`; inline sites at `organizations/routes.ts:22,42,61,80,98,113`; `farms/routes.ts:40,92`; `marketplace/routes.ts:188,211`; `services/routes.ts:165,230`; `payments/routes.ts:529`; `disease/routes.ts:193`; `admin/routes.ts:19-23`

**Evidence — the permission table declares 26 strings; only 13 are reachable via `requirePermission`:**
Unenforced: `orders:read:any`, `orders:read:own`, `orders:manage`, `bookings:manage:any`, `bookings:manage:own`, `bookings:execute`, `inventory:manage`, `farmers:assist`, `membership:manage`, `org:read`, `org:manage`, `farm:read:org`, `procurement:read:org`.

**Consequence:** `FIELD_AGENT: ["farmers:assist"]` and `WAREHOUSE_MANAGER: ["inventory:manage"]` hold **only** unreachable permissions — they can authenticate but no route is gated on what they may do. `REGIONAL_MANAGER` holds `orders:read:any` but `GET /orders` denies it via `["ADMIN","SUPER_ADMIN"].includes(getAuth(req).role)`. The organisations module uses a **third** role vocabulary (`OrganizationMember.role ∈ ADMIN|MEMBER|VIEWER`) absent from `contracts/roles.json`.

**Why the gates cannot see it:** `tests/route-role-matrix.test.ts`'s parser is static and only recognises `requirePermission("…")`, so `docs/route-role-matrix.md:294-299` renders every organisations route as permission `—` / *"any authenticated role"* while `organizations/routes.ts:22` refuses `FARMER` outright. `AGENTS.md` §5 says `requirePermission` is *"the only gate"*; the artefact the repo treats as the authorisation authority is wrong for **7 modules / 19 sites**. No exploitable hole was found (every inline check is fail-closed — it excludes roles more often than the table would), but a future role addition lands unguarded and undetected.

**Fix direction:** convert the inline lists to `requirePermission` (which is what makes the dead permissions live), or extend the generator to parse and report them. Add a test asserting every declared permission is reachable from ≥1 route or explicitly recorded as deliberate.

---

#### F-09 · P1 · The offline-queue cross-account ownership guard is dead code in production
**Domain:** Web / data isolation · **Confidence:** VERIFIED-BY-READING (lead auditor)
**Files:** `apps/web/src/lib/offlineQueue.ts:289,345-356,236-252`; `apps/web/src/lib/sessionManager.ts:251`; `apps/web/src/lib/session.tsx:5`

**Evidence:**
```ts
ownerId: getSession()?.userId ?? "",                    // offlineQueue.ts:289 → always ""
if (entry.ownerId && entry.ownerId !== currentOwner) {  // :349 → skipped, "" is falsy
```
`session.tsx` imports only `getTokens, clearTokens`. **No production caller of `sessionManager.setSession` exists** — the only callers are `offlineQueue.test.ts:494-526`. So `_session` stays `null` forever and `ensureSessionWatch` always early-returns. `purgeQueue` and `broadcastLogout` likewise have no caller outside tests.

**Impact:** the shared phone is the product's own stated case (*"the common case in the markets this app targets"*, `offlineQueue.ts:196-198`). Farmer A queues cart/farm-event writes offline and logs out; nothing is purged because nothing can be; farmer B signs in and `flushAll()` replays A's writes **with B's bearer token** — cart items and farm events land in B's account and no one is told. The 72 h TTL is the only bound. The unit suite passes because it calls `setSession` directly; the production path never does.

**Fix direction:** call `sessionManager.setSession({userId, fullName, role, lang})` from `SessionProvider` and `broadcastLogout()` from logout; add an e2e case for "queue → logout → other account signs in".

---

### Legal & privacy

#### F-10 · P1 · The privacy policy misstates where user data is hosted
**Domain:** Legal / compliance · **Confidence:** VERIFIED-BY-READING (lead auditor)
**Files:** `PRIVACY_POLICY.md:148`; `docs/runtime-contract.md:23-32`; `docs/STATUS.md:38`; `vercel.json`, `apps/api/vercel.json` (both contain **no** `regions` block)

**Evidence:**
- Policy: `| Hosting provider | running our servers (Bangladesh/Singapore region) |`
- Runtime contract: `| API function execution | iad1 (US East) | X-Vercel-Id: bom1::iad1::… |` and *"observed `iad1` is consistent with the platform default, not with a repository decision."*

**Impact:** farmer PII — phone, farm address, plot GPS, orders, wallet ledger — is processed in the US while the tracked policy says Bangladesh/Singapore. Bangladesh cross-border-transfer posture and the Play Data Safety answers both rest on this sentence. Mitigating detail: the **published** in-app text (`apps/web/src/features/legal/content.ts`) is silent on region, so the exposure is the tracked markdown that `PRIVACY_POLICY.md:5-8` presents as canonical *("the app serves this policy at `/privacy`")* — i.e. the file that would be handed to counsel or the Console.

**Fix direction:** either pin the function and Neon region to Singapore and keep the claim, or correct the claim and spell out the transfer. Do not leave the two documents disagreeing.

---

#### F-11 · P1 · Two divergent privacy policies ship in one repository, and the tracked one is less accurate
**Domain:** Legal / privacy · **Confidence:** VERIFIED-BY-READING
**Files:** `PRIVACY_POLICY.md` (12,049 B, "Version 1.1") vs `apps/web/src/features/legal/content.ts:47-258` (the text actually served at `/privacy`)

**Evidence (three substantive divergences):**
- **Analytics identifiability.** Tracked text `PRIVACY_POLICY.md:110` says *"Basic app-usage events | which screens were opened (**no identifying data**)"*. The implementation disagrees: `apps/api/src/modules/analytics/routes.ts:41` writes `userId: getAuth(req).userId` on every event and `schema.prisma` declares `@@index([userId, createdAt])` — every event is directly attributable to a user. The published text correctly avoids the claim.
- **AI/weather transfer.** The published §6 discloses *"when you request advice, the relevant input (your area's coordinates or your question) is processed"* (`content.ts:190-192`) and `docs/play/data-safety.md:47` declares it to the Console. `PRIVACY_POLICY.md:142-151` omits the AI and weather providers entirely.
- **Retention.** The tracked §5 has four rows including the 180-day security/usage row; the published version has three.

**Impact:** a factual misstatement in a tracked legal document, plus two "canonical" texts that disagree on data-sharing — whichever the owner submits, the other is a discoverable contradiction.

**Fix direction:** make `content.ts` the single source and generate `PRIVACY_POLICY.md` from it (or vice versa); add it to the doc gates.

---

#### F-12 · P1 · Account deletion leaves farm location and advisory free text behind, contrary to the documented promise
**Domain:** Privacy / data protection · **Confidence:** VERIFIED-BY-READING (code and doc quotes verified; legal interpretation out of scope)
**Files:** `apps/api/src/modules/auth/routes.ts:648-737`; `apps/api/src/shared/retention.ts:32`; `docs/data-protection.md:18,114`

**Evidence:** the deletion handler anonymises only `User` (name/email/phone/passwordHash/status/notificationPrefs/region) and `FarmerProfile` (address/district/upazila/nidLast4), deletes OTPs, revokes tokens and purges photo files. It does **not** touch `Farm.address/district/upazila/lat/lng`, `FarmEvent.title/notes`, `AdvisoryQuery.question/answer` (retained up to 180 days), `Notification.body`, `AuditLog.ip`, or the `LoginAttempt` row. Meanwhile `docs/data-protection.md:18` says account/profile data is *"deleted/anonymized at account deletion (incl. `region`, address fields)"* and the Play data-safety table `:114` marks *"Physical address (farm location/GPS)"* as **Deletable: Yes**.

**Impact:** a deleted user's farm address and coordinates remain queryable indefinitely and AI questions may contain free-text personal data — a claim the code does not implement, in the two documents a regulator or the Play Console would read.

**Fix direction:** extend deletion to anonymise farm geo fields and advisory text, or correct the two doc claims and record them as explicit residuals in the style the repo already uses at `data-protection.md:62`.

---

### Verification integrity

#### F-13 · P1 · The documented pre-push duplication gate fails deterministically on the current tree
**Domain:** QA / process · **Confidence:** VERIFIED-BY-RUNNING (lead auditor)
**Files:** `package.json:22`; `.jscpd.json`; `.github/workflows/ci.yml:92`

**Evidence:**
```
$ npm run qa:jscpd
Found 109 clones.
ERROR: jscpd found too many duplicates (3.4%) over threshold (3.0%)

$ npx jscpd --silent --threshold 3 apps/api/src apps/web/src   # exactly what ci.yml:92 runs
Found 37 exact clones with 530 (1.97%)
```

**Impact:** `AGENTS.md` §9 and `CONTRIBUTING.md` both instruct developers to run `npm run qa:jscpd` expecting "duplication ≤ 3%". It fails every time. CI is green only because its scope is narrower — the whole test, e2e, scripts and workflow surface is excluded (yaml 6.34%, tsx 3.54%). Offenders include `docs/archive/2026-10-19/generated/route-matrix.json` vs `docs/generated/route-matrix.json` (185+168+53+37 lines), the two Postgres service blocks in `ci.yml` itself (35 lines), `apps/web/vercel.json` vs `vercel.json` (40 lines), and test-harness boilerplate. The natural reaction to a permanently red gate is to **lower the threshold** — a ratchet violation waiting to happen.

**Fix direction:** make the npm script mirror CI's arguments, or add the archive/contract-mirror/test-boilerplate paths to `.jscpd.json` with written reasons. Do not lower the threshold.

---

#### F-14 · P1 · The sandbox payment provider — the pilot's live payment mode — has zero function coverage, and the config asserts the opposite
**Domain:** QA / money · **Confidence:** VERIFIED-BY-READING (coverage artefact + source)
**Files:** `apps/api/vitest.config.ts:19-24`; `apps/api/src/providers/payment/sandbox.ts`; `apps/api/src/modules/payments/routes.ts:272-291`

**Evidence:** `vitest.config.ts` states *"`payment/sandbox.ts`, `payment/sslcommerz.ts`, `storage/s3.ts` … are all instrumented — each has a test that exercises it."* The coverage artefact reports `src/providers/payment/sandbox.ts | 40% lines | **0 (0/2) functions**`. The cause is visible in the route: the sandbox branch never calls the provider —
```ts
if (provider.mode === "live") { intent = await provider.createPayment({…}); … }
else { gatewayRef = `SBX-${Date.now()}-${Math.random()…}`; }
```
so `SandboxPaymentProvider.createPayment/verifyPayment` are dead code, while `paymentsReadiness()` still reports `provider: "sandbox"` from that class. `PAYMENT_PROVIDER=sandbox` is the pilot's **live** payment mode (`docs/STATUS.md`).

**Impact:** the money component that actually runs has zero provider-layer coverage, and the file that documents the coverage argument is factually wrong — a reader concludes it is covered. Route-level sandbox behaviour *is* well covered (`journey-marketplace`, `payment-confirm-webhook-race`, `payments-refund-provider-mode`, `payments-integrity`), so this is a coverage-comment lie plus a dead class, not an untested money path.

**Fix direction:** delete the dead class or route sandbox intents through it; correct the comment.

---

#### F-15 · P1 · A security scenario the release register counts as PASS always self-skips in CI
**Domain:** QA / security evidence · **Confidence:** VERIFIED-BY-RUNNING (arithmetic from CI logs + workflow grep)
**Files:** `apps/web/e2e/scenarios-auth.spec.ts:154-168`

**Evidence:**
```ts
const up = await page.request.get("http://127.0.0.1:4100/health", { failOnStatusCode: false, timeout: 3_000 }).catch(() => null);
test.skip(up === null, "prod-config probe not running (node apps/web/e2e/prod-config-probe.mjs)");
```
`grep -rn "prod-config-probe" .github/` → **no workflow references it**. CI starts only the API (:4000) and the web server. Log arithmetic confirms it: 96 collected; dev pass `94 passed + 2 skipped`; preview pass `95 passed + 1 skipped` — the only always-skipped test is AUTH-04.

**Impact:** "demo credentials cannot authenticate against a production-configured service" is asserted **nowhere**, yet the scenario register lists it as PASS on the strength of a manual drill. Secondary hazard: an unrelated leftover server on `:4100` would make the test run against an unknown service and pass for the wrong reason.

**Fix direction:** start the probe in the e2e job (it is a one-command node script) or mark the scenario manual-only in `docs/qa/test-traceability.md`. Also assert the port is not already answering before skipping.

---

#### F-16 · P1 · The licence ratchet is misnamed in the governance doc, and the gate the doc names is invisible to CI
**Domain:** Governance / docs · **Confidence:** VERIFIED-BY-RUNNING (lead auditor)
**Files:** `AGENTS.md:162`; `scripts/qa/check-licenses.mjs:26`; `scripts/licence-gate.mjs:12`; `license-allowlist.json`; `scripts/licence-allowlist.json`; `.github/workflows/ci.yml:94`

**Evidence:**

| Gate | Reads | Wired in CI? | Verified result |
|---|---|---|---|
| `npm run qa:licenses` → `scripts/qa/check-licenses.mjs` | repo-root `license-allowlist.json` | **No** — 0 workflow references | `clean: 171 production packages` |
| `node scripts/licence-gate.mjs` | `scripts/licence-allowlist.json` | Yes (`ci.yml:94`) | `OK — 160 production packages` |

`AGENTS.md:162` lists the ratchet as `scripts/qa/license-allowlist.json` — **that path does not exist**. Two real files exist, at two different paths, with two different spellings (`license` in root, `licence` in `scripts/`), read by two different gates with a 11-package difference in scope. Neither `scripts/licence-allowlist.json` is covered by `CODEOWNERS`.

**Impact:** an agent or contributor trusting §9 asserts against a phantom path; the two allow-lists can silently diverge; the ratchet lives in a different directory from every other `qa:` gate.

**Fix direction:** correct `AGENTS.md` to both real paths; decide whether the two gates are one gate; add both files to `CODEOWNERS`; standardise the spelling.

---

### Governance & release

#### F-17 · P1 · Five CI jobs — including the migration-drift gate and the entire quality-gates job — are not required status checks
**Domain:** Governance / CI · **Confidence:** VERIFIED-BY-RUNNING (lead auditor, `gh api`)
**Files:** `.github/workflows/ci.yml:76,176,606,676`; ruleset `25297401`

**Evidence — the ruleset's 11 required contexts, read back verbatim:**
`API — Lint · TypeCheck · Tests (SQLite)`, `API — Integration & Concurrency (PostgreSQL 17)`, `Web — Lint · Unit · Build`, `Web — E2E (Playwright)`, `Android — Build debug APK artifact`, `Docker — Build images`, `Security — Dependency audit & secret scan`, `Security — Gitleaks secret scan`, `Security — Trivy container scan (HIGH/CRITICAL)`, `Analyze (javascript-typescript)`, `CodeQL`.

**Absent from the required list, yet running on every PR:**
- `API — Migration chain vs schema (PostgreSQL 17)` (`ci.yml:176`)
- `Quality gates — knip / jscpd / licences / commitlint / migration drift` (`ci.yml:76`)
- `Docker — Compose smoke (db + api)` (`ci.yml:606`)
- `Security — IaC config scan` (`ci.yml:676`)
- `ZAP baseline against the composed API` (`dast.yml`)

**Impact:** `AGENTS.md` §6 asserts *"Any schema change must be mirrored … and must keep `api-migration-drift` green."* A PR can merge with it red. So can every ratchet that lives in `quality-gates`: jscpd ≤ 3%, the licence allow-list, the lint-warning budget (143/0), commitlint, the TODO gate, and generated-doc freshness. These are real gates — they are simply not blocking.

**Fix direction:** add the five contexts to the ruleset; they already report stable names.

---

#### F-18 · P1 · The container/staging deploy path cannot execute: four independent blockers
**Domain:** Release / DevOps · **Confidence:** VERIFIED-BY-READING
**Files:** `docker-compose.prod.yml:32,44,46-47,78,84-88`; `.github/workflows/deploy-staging.yml:59,77,115-123,138`; `docker/api.Dockerfile:33-38,50`; `docs/deployment.md:57-59`

**Evidence — four separate blockers:**
1. **Wrong image namespace.** Compose pulls `ghcr.io/agrobridge/agrobridge/api:${API_IMAGE_TAG:-latest}`, but the workflow pushes to `${{ env.REGISTRY }}/${{ github.repository }}/api` = `ghcr.io/tanviruchahs2580/agrobridge/api:sha-<sha>`. Neither the namespace nor the `:latest` tag exists anywhere. Supply-chain angle: `:latest` with no digest means a prod stack would pull whatever tag exists under a namespace the project does not own.
2. **Missing mounts.** The workflow `scp`s only `docker-compose.prod.yml`. The prod compose requires `./docker/postgres-init` (line 32), `./docker/web.nginx.prod.conf` (line 85) and `env_file: .env` (line 47). Docker creates a *directory* where the nginx config should be, and nginx fails to read it.
3. **The documented migration command cannot run.** `docker/api.Dockerfile:50` does `RUN rm -rf … /usr/local/bin/npm /usr/local/bin/npx` and lines 33-38 delete `node_modules/prisma`, `@prisma/engines`, `.bin/prisma`. Every documented invocation is therefore impossible: `deploy-staging.yml:138` (`exec api npx prisma migrate deploy`), `docker-compose.prod.yml:9`, `docs/deployment.md:59`.
4. **Docs repeat a line.** `docs/deployment.md:57-58` contains the same `docker compose … up --build -d` command twice.

**Impact:** the only non-Vercel deploy path is triply broken — consistent with `deploy-staging.yml`'s run history (2 runs, 0 successes, both dying in the secrets guard before reaching these). `AGENTS.md` §14 calls staging "a scaffold"; the deeper fact is that *closing* the scaffold as documented will not work. The documented rollback (`API_IMAGE_TAG=sha-<prev>`) cannot work either.

**Fix direction:** pin compose to the real namespace with `${…_IMAGE_TAG:?}` (no default), ship a deploy bundle (compose + `docker/` + rendered env), separate migration from application deploy, and add a `docker compose config` validation step to CI — no workflow currently parses the prod compose file at all.

---

#### F-19 · P1 · Zero repository secrets exist, so no mobile or staging release is exercisable
**Domain:** Release / DevOps · **Confidence:** VERIFIED-BY-RUNNING
**Files:** `.github/workflows/android-release.yml`, `deploy-staging.yml`, `play-upload.yml`

**Evidence:** `gh secret list --json name` → `[]`; `gh variable list` → `[]` (both exit 0). Run history: `android-release` 1 run / **1 failure** (dies in "Fail fast if signing secrets are absent"); `deploy-staging` 2 runs / **0 successes**; `play-upload` **0 runs**.

**Impact:** `AGENTS.md` §10's *"Signing secrets … live only in CI"* is not true today — the capability does not exist. There is **no working path to a Play upload**, and the elevated-keystore secret set (`ANDROID_KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) plus `PLAY_SERVICE_ACCOUNT_JSON` are all absent. Additionally `deploy-staging.yml:156` falls back to `https://staging.agro.example.com`, a placeholder that will not resolve, so that workflow fails a *third* time even after the secrets land — `STAGING_BASE_URL` must be a repository **variable**.

**Fix direction:** owner creates 8 secrets + 1 variable, then dispatches `android-release.yml` once to prove the path end-to-end. This is an owner action, not a code defect — but it is the top release-readiness gap.

---

#### F-20 · P1 · The money-path reconciliation job is scheduled nowhere, on a host that does not exist
**Domain:** Ops / money · **Confidence:** VERIFIED-BY-READING + VERIFIED-BY-RUNNING (`git grep`)
**Files:** `apps/api/scripts/reconcile-wallet.mjs:6`; `docs/runbooks/failed-transaction-recovery.md:21`; `docs/adr/0010-job-durability.md:34`; `apps/api/vercel.json`

**Evidence:** `* Run via cron: 0 4 * * * cd /srv/agrobridge/apps/api && node scripts/reconcile-wallet.mjs` — and production is Vercel + Neon (`docs/runbooks/live-deployment.md:5-9`). There is **no `/srv/agrobridge` VM**. The only cron in `apps/api/vercel.json` is `/api/v1/ops/retention`. `git grep "0 4 \* \* \*"` finds only the two doc comments.

**Impact:** the wallet reconciliation that "alerts on" balance/hold mismatches never runs in production, so a stuck-money condition is undetected by the very mechanism the runbook names as its trigger. ADR-0010's claim that it is a daily job is aspirational. Combined with **F-27** (alerts cannot fire in production) this means the money path has **no automated detection in production at all** — only the operator noticing.

**Fix direction:** add a Vercel cron (or a scheduled GitHub workflow hitting a `CRON_SECRET`-guarded ops endpoint) and update ADR-0010 and the runbook to the real transport.

---

### Documentation & evidence integrity

#### F-21 · P1 · The evidence layer that justifies the safety claims is not in the repository, 70% of symbol citations are stale, and two tracked audits contradict each other
**Domain:** Documentation / evidence · **Confidence:** VERIFIED-BY-READING + VERIFIED-BY-RUNNING (citation scan, `git cat-file`)
**Files:** `docs/STATUS.md:114-127`; `docs/runtime-contract.md:15,16,23,24`; `docs/threat-model.md:28,53`; `docs/slo.md:4,65,68,74`; `docs/data-protection.md:11`; `docs/audit/*`; `.git/info/exclude:9-11`

This is one finding in three parts because the three parts are the same defect — *the repository cannot verify its own strongest claims* — and each part makes the others unverifiable.

**(a) ~30 tracked-document references point into an untracked tree.**
All eight paths `docs/STATUS.md` lists as *"Where the evidence lives"* are missing: `.audit/v2/{BASELINE,DECISIONS,FINDINGS,RISK_REGISTER,CLAIMS_LEDGER,SCORECARD,FINAL_AUDIT_REPORT}.md`, `.audit/evidence/E-V2-live-probes.txt`. The originals live under `.audit-archive/pre-v3-final-20261030/v2/`. `.audit/`, `.audit-archive/` and `.agent-evidence/` are excluded **only** by `.git/info/exclude` — a machine-local file that is not cloned and not reviewed. The runtime contract's region claim, the threat model's three control claims and the SLO's objectives all resolve to `E-V2-live-probes.txt`, which does not exist on disk, is not in git, and is not reproducible.

**(b) 64 of 91 symbol-naming citations in 10 core documents do not contain the named symbol** within ±3 lines of the cited range (**70%**). Hand-verified examples:
- `docs/architecture.md:163` cites `auth/routes.ts:168-224` "(login at 168)" — line 168 is `export const POLICY_VERSION = "1.1";`
- `docs/architecture.md:227` cites `payments/routes.ts:217-251` for `claimAndApplyPayment`, defined at **362** — off by 145
- `docs/business-rules.md:27` cites `payments/routes.ts:196-206` for `durationDays`, which is at **185**
- `docs/legal-compliance-checklist.md` cites `auth/routes.ts:520-542` for `DELETE /me`, which is at **645**

Every *"Source of truth: file:line"* in the ADRs, threat model, business rules, SLOs and legal checklist rests on this apparatus. Stale citations are worse than none because they defeat spot-checking.

**(c) The two tracked audit reports contradict each other and cite commits that do not exist.**
`docs/audit/2026-10-29-agrobridge-enterprise-audit.md:7` — *"Verdict: `COMPLETE`"*, *"Final score (uncapped) 83.78 / 100"*, *"Caps applied: none"*. `docs/audit/AUDIT-REPORT-20261030.md:3` — *"Verdict: INCOMPLETE — FAIL"*, *"Achieved score: 95.07 / 100"*. Verified-SHAs `980bf41`, `c163de5` and `a5f29a8` are all unresolvable from `main` (`git cat-file -t` → not found); `a5f29a8` exists only on an unmerged branch and carries **the same PR number (#88)** as `main`'s `7a718c5`. `docs/audit/AUDIT-REPORT-20261030.md` is a byte-identical duplicate (EOL-normalised md5) of the untracked `.audit/reports/PUBLIC.md`.

**Impact:** every security, runtime and SLO claim in the repository is, in the strict sense `AGENTS.md` §1's own evidence discipline demands, **NOT DETERMINED**. This is why the two audits could both claim "verified" from unreachable SHAs without any gate objecting, and it is why this report does not reproduce their scores.

**Fix direction:** publish a curated tracked `evidence/` tree containing the artefacts the docs cite; move `.audit*` and `.agent-evidence` rules into `.gitignore`; make `link-check` refuse untracked targets (**F-46**); add a CI assertion that any SHA named in a tracked report is an ancestor of `main`; re-stamp one current verdict and date-banner the rest.

---

## 5. Findings — P2 (Medium)

*43 findings. Fix before scaling beyond a controlled pilot.*

| ID | Domain | Title | Evidence (file:line) | Impact | Fix direction | Conf |
|---|---|---|---|---|---|---|
| **F-23** | API/money | Both "void" paths shred the client key, same class as F-02 | `lib/pendingIntents.ts:32`; `payments/routes.ts:317` — `metaStr: JSON.stringify({ cancelledReason: params.reason })` | After an order/booking cancel or intent supersede, a keyed retry creates a brand-new payment instead of replaying — the opposite of `findPaymentByClientKey`'s documented contract | Merge into existing meta (`{...paymentMetaOf(metaStr), cancelledReason}`) instead of replacing | VERIFIED-BY-READING |
| **F-24** | API/money | A captured payment the webhook cannot apply is acknowledged 200 with no audit, log or metric | `payments/webhook.ts:101-103` — `return ok(res, { received: true, processed: false, reason: "not_claimable" })` | Money is at the gateway, the `Payment` row is `FAILED`/`REFUNDED`, and the only detector (`reconcile-wallet.mjs`) never looks at gateway payments. `PaymentFailures` cannot fire and no human is told | Emit `audit({action:"PAYMENT_NOT_CLAIMABLE"})` + counter + warn log with `tranId`/`paymentId`; extend reconciliation to flag gateway-paid non-PENDING rows | VERIFIED-BY-READING |
| **F-25** | API/money | Refund debits the **farmer's** wallet for money returned by the gateway, invisibly | `payments/routes.ts:615-632` — `update: { balancePaisa: { decrement: payment.amountPaisa } }` with `direction: "DEBIT"` | Order payments never credit the wallet, so the refund DEBIT has no counterpart CREDIT: a farmer with withdrawable balance from procurement payouts sees it reduced by a refund they received. The ledger-sum invariant still holds, so reconciliation reports OK. Documented (BR-35) and tested — **raised as a question, not a defect** | Confirm intent; if the debit stays, label it in the response/notification as platform bookkeeping, not a wallet movement | VERIFIED-BY-READING / policy |
| **F-26** | API/obs | HTTP metrics mislabel every pre-handler refusal as `route="unmatched"` | `infrastructure/metrics.ts:51-53` — `req.route` is set only when the route layer dispatches | **401, 403 and 429 for real matched endpoints are all counted as `unmatched`.** Verified live: 2× `GET /products` → two 401s and two 429s, all `{route="unmatched"}`. `alert_rules.yml` has no 401/403 rule and could not attribute one per route. `AGENTS.md` §12 requires authz-failure alerting | Fall back to `req.baseUrl` when `req.route` is undefined; add a 401/403 rate alert on the resulting series | VERIFIED-BY-RUNNING |
| **F-27** | DevOps/obs | Every alert is inert in production, and there is no authorisation-failure signal at all | `monitoring/prometheus.yml:17` (`targets: ["api:4000"]`); `docker-compose.yml:96-99` (`profiles: ["monitoring"]`); `metrics.ts:6-42` | Production is Vercel + Neon — scraped by nothing; no Alertmanager or sink exists. `PaymentFailures` is a real, tested rule that cannot fire. The 5 defined metrics include none for 401/403/permission denials | Expose `/metrics` to a hosted scraper (the token guard already fails closed — verified 403 anonymously); add an Alertmanager/webhook sink; add `agrobridge_auth_failures_total{route,reason}` + a rule | VERIFIED-BY-READING + VERIFIED-BY-RUNNING |
| **F-28** | API/obs | `providers/health.ts` is a dead registry: `markDown` writes state nothing reads | `providers/health.ts:18,22,57-63`; only caller `providers/ai/gateway.ts:81-82` | In production an AI provider failure records degradation into a module-level object that no route, metric or log reads. `initHealthRegistry` never runs. `resilienceState()` is commented "the hook for `/ready` or metrics wiring" and has no production consumer — breaker state is invisible. **The repo's own audit evidence certifies a consumer that does not exist** (`.audit-archive/.../E-1518-i05-provider-resilience.txt:21`: *"admin surface reads it"*) | Wire the registry into `/ready`/metrics (the AI/SMS/storage states are exactly readiness facts) or delete the module and the `markDown` call | VERIFIED-BY-READING |
| **F-29** | QA | Web unit coverage: 19 source files at 0%, including the largest screens | `apps/web/coverage/lcov.info` (2026-10-30) | Zero-coverage files include `Market.tsx` (170 L), `Settings.tsx` (113), `Admin.tsx` (87), `MyFarm.tsx` (86), `App.tsx` (77), `Services.tsx` (95), `Notifications.tsx` (58). e2e mitigates substantially (94/95 tests) but "web coverage gate met" must not be read as "the screens are tested" | Raise the floor only as feature suites land — do not treat 43% as adequate | VERIFIED-BY-READING |
| **F-30** | QA | `global-setup` deletes `prisma/test.db` unconditionally → any concurrent run destroys a suite's database (reproduced live) | `apps/api/tests/global-setup.ts` (rmSync block, before `DATABASE_URL` is consulted) | **Reproduced by the lead auditor: 50 failed tests / 15 files, all `The table main.User does not exist`.** Any developer or agent running a subset while a suite runs gets unattributable failures | Derive the DB path from `DATABASE_URL`; take a lock file; document the Windows workaround already in `.audit/STATE.md` | VERIFIED-BY-RUNNING |
| **F-31** | QA | Wallet reconciliation has no automated proof on PostgreSQL | `apps/api/tests/wallet-reconciliation.test.ts:56-61` (`describe.skip` on PG) | The money-integrity reconciliation is proven on SQLite only; the test comment implies a PG CI proof that does not exist | Convert the PG skip into a real test using a disposable PG schema | VERIFIED-BY-READING |
| **F-32** | QA | Lint-warning budget saturated at exactly 143/143 — zero headroom | `scripts/qa/lint-warning-budget.json`; `lint-budget.mjs` output `api errors=0 warnings=143 (budget 143)` | Policy-sanctioned, but **any** new warning now fails CI, so a legitimate warning must be accompanied by a debt paydown. Worth deciding deliberately rather than discovering mid-sprint | Pay down ≥10 warnings to restore headroom, or record the zero-headroom decision | VERIFIED-BY-RUNNING |
| **F-33** | Web/perf | The performance budget cannot fail: 2 of the last 3 recorded Lighthouse runs measured **no LCP at all** | `apps/web/lighthouserc.json`; `.lighthouseci/assertion-results.json` → `[]` | run1 perf=83 / LCP 4438 ms (under the 5000 ms gate); **run2 and run3 perf=0, `NO_LCP`** (`score: null`, `errorMessage "NO_LCP"`). With `numberOfRuns: 3` and a median aggregate, two error runs make the LCP/TBT "error" assertions vacuous. The splash (`components/Splash.tsx:94-98,128-136`, `fixed inset-0` holding the h1) unmounts 280 ms after handoff — the LCP candidate leaves the DOM before capture | Measure a route that does not self-destruct its LCP element, or treat `score === null` as failure in the assert step | VERIFIED-BY-RECORDED-RENDER |
| **F-34** | Web/a11y | WCAG 2.5.3 (Label in Name, Level A) failure on both language toggles — and the project's axe gate structurally cannot see it | `lib/publicLanguage.tsx:51-61`; `App.tsx:202-209`; recorded run `.lighthouseci/lhr-1793381661262.json` audit `label-content-name-mismatch` **score 0** | `<button aria-label="Switch to English">EN</button>` — *"Text inside the element is not included in the accessible name"*. Speech-input users cannot activate the control by its visible name. axe-core has no equivalent rule, so `e2e/a11y.spec.ts` cannot flag it and the Lighthouse category still scores 100 | Make the accessible name start with the visible text: `aria-label={`${t("langToggleButton", lang)} — ${t("langSwitchAria", lang)}`}` | VERIFIED-BY-RECORDED-RENDER |
| **F-35** | Web | Login applies the **registration** password policy to authentication | `features/auth/Login.tsx:24-26,34,131` vs `apps/api/src/modules/auth/routes.ts:182-185` | The API's login schema is `password: z.string().min(1)`; the client blocks `<8` and shows *"Weak password — use at least 8 strong characters"* for a mistyped short password instead of "wrong password", and the submit button is dead until blur. A legacy/seeded account with a short password can never sign in from the web client | Drop `inputInvalid` / the `<8` rule from Login; keep it on Register and Reset | VERIFIED-BY-READING |
| **F-36** | Web | Register discards the language the visitor just chose | `features/auth/Register.tsx:14,18,24,55,72-75` | `const [langPref, setLangPref] = useState<"bn" \| "en">("bn")` is independent of `usePublicLang()`. A visitor who switched to English on `/login` registers in an English UI but persists `bn` → the whole app flips to Bengali after sign-in | Seed `langPref` from `usePublicLang()`'s value | VERIFIED-BY-READING |
| **F-37** | Web | `t()` is called with a key derived from a raw database string → one unexpected value crashes the whole Sell Crop screen | `features/sell-crop/SellCrop.tsx:174,191`; `lib/i18n.ts:715-717` | `t(GRADE_KEYS[o.qualityGrade], lang)` where `qualityGrade: string \| null` (`api-types.ts:493`) and `t()` throws on an unmapped key. Every other enum axis uses `lib/labels.ts`'s `fromMap` raw fallback; this one call site does not | `t(GRADE_KEYS[g] ?? "qualityGrade", lang)` or route through `lib/labels.ts` | VERIFIED-BY-READING |
| **F-38** | Web | Server validation errors are prefixed "this field is required" even when the field is filled in | `lib/errors-ui.ts:194-196,206` | For any single-field 400 the user reads *"এই ঘরটি পূরণ করুন: পাসওয়ার্ড খুব ছোট"* ("This field is required: password is too short") — a contradiction. This is the generic path that surfaces **every** unmapped server rejection | Drop the `errFieldRequired` prefix; test "required" after length/format tests | VERIFIED-BY-READING |
| **F-39** | Web | Long lists are silently truncated and the API's truncation signal is discarded | `features/marketplace/Market.tsx:96`; `lib/api-types.ts:365`; `lib/api.ts:322-407`; `features/orders/MyOrders.tsx:43-48` | `api<ProductList>("GET", "/products?pageSize=50…")` — `ProductList = Paged<…>` has `total`/`totalPages` which the UI never reads and has no pager for. `GET /orders` returns `take: 100` with the comment "the caller can tell a full list from a truncated one" via `X-Total-Count`, but `api()` returns only `json.data`, so the header is unreachable | Render a pager from `total/totalPages`; give `api()` an opt-in `{raw:true}` so `X-Total-Count` can reach MyOrders | VERIFIED-BY-READING |
| **F-40** | API/sec | `/ready` publishes internal configuration to unauthenticated callers | `app.ts:120-137` | Returns `db`, `schema.latest` (migration name), `limiterStore`, `storage: {provider, durable}`, `payments: {provider, sandbox}`. Free reconnaissance: `payments.sandbox` tells an attacker whether simulated payments can be completed on this deployment; `storage.durable=false` advertises that uploads vanish on redeploy | Keep the boolean readiness signal public for the deploy gate; move the introspection block behind `METRICS_TOKEN` or an admin check (and update the gate script) | VERIFIED-BY-READING |
| **F-41** | Web | The theme toggle desyncs its state from the painted theme when the OS preference changes live | `lib/session.tsx:67-83` | The effect that paints the theme runs once (`}, []);` at :83 with `eslint-disable react-hooks/exhaustive-deps`); the OS listener only does `setDark(e.matches)` and never `applyTheme`. An OS light→dark flip flips the icon and `aria-pressed` while `html[data-theme]` stays light — the control lies about the app's state. Here the suppression is **load-bearing and hides a real defect** | Put `applyTheme(dark)` in a `useEffect` keyed on `dark` | VERIFIED-BY-READING |
| **F-42** | Web/CI | Playwright will silently reuse **another project's** dev server on the shared port 5173 | `apps/web/playwright.config.ts:126-136` — `reuseExistingServer: true` | `AGENTS.md` §3 states 5173 is also Bangla GPT's dev port and that the two must not run concurrently. Reuse turns that collision into a **green run against the wrong application**. The config's own comment records an IPv6 shadowing incident on this exact port | `reuseExistingServer: false` locally, or gate reuse on a build-identity probe (`GET /version.json` matching `VITE_GIT_COMMIT`) | VERIFIED-BY-READING |
| **F-43** | AI | Hosted-path confidence is a hardcoded cosmetic constant, and "grounded" means only "something was retrieved" | `providers/ai/openai-compat.ts:149-165` — `const confidence = grounding ? 0.75 : 0.45;` where `grounding = entries.length > 0` | Any hosted answer scores 0.75 → `lowConfidenceFlag=false` → `supportLabel.ts` renders *"Source match: good"* with KB titles listed as its sources, even if the model answered from parametric memory. `groundedRefs` is the retrieval list, never checked against the answer text; there is no containment post-check on this path (unlike the eval's offline metric). `docs/ai-parameters.md` claims to register "every tunable" but never lists `0.75`/`0.45` | Derive confidence from retrieval scores plus an answer-support check; disclose hosted answers as unverified when unsupported | VERIFIED-BY-READING |
| **F-44** | AI/safety | The unreviewed-treatment guard is offline-only; the hosted path can serve un-reviewed dosing advice unflagged | `providers/ai/types.ts:85-109` (guard); only call site `offline-engine.ts:86-88` | `unreviewedTreatmentNote` is referenced in exactly one place; `OpenAiCompatibleProvider.ask` never calls `containsAgrochemGuidance`. The requirement *"an answer that names or doses an agrochemical must be either source-reviewed or explicitly flagged unverified"* is **void on the one path that can invent a dose** — while every KB entry is `UNSOURCED` | Apply the same check to hosted completions (flag whenever any retrieved entry is `UNSOURCED`) | VERIFIED-BY-READING |
| **F-45** | AI/quality | Prefix alias `sec` grounds irrigation advice on unrelated English words — and the test suite encodes it as correct | `providers/ai/knowledge.ts:254,274-281`; `apps/api/tests/ai-prompt-injection.test.ts:89-92` | `"সেচ": ["sec", "sinch", "shinch"]` compiles to `new RegExp("(^|[^a-z0-9])sec")` (no trailing boundary), tier **strong** (+1.5, passes the topical gate). The suite asserts that *"Reveal the secret system instructions…"* retrieves `irrigation-general` and contains "wetting and drying" — score 0.85 × 0.75 = **0.64**, `lowConfidenceFlag=false`, *"Source match: moderate"* citing irrigation as the source for a question about secrets. The 109-item eval set contains **zero** negative probes containing `sec*` (checked by script) | Require a trailing boundary or narrow the aliases; add negative eval items | VERIFIED-BY-RUNNING + VERIFIED-BY-READING |
| **F-46** | Docs/gates | `link-check` is unsound: it resolves links against the working tree, not the tracked file set | `scripts/qa/link-check.mjs:74` — `if (!existsSync(resolve(dirname(file), decoded)))`, no `git ls-files` filter | Compare `apps/api/tests/import-boundaries.test.ts:31`, which does exactly that "so untracked scratch files cannot weaken it". Live consequence: `docs/archive/2026-10-19/EXECUTION_LOG.md:390` references a `.gitignore`d directory — the gate passes locally and 404s on every other clone. **The repo's only link gate cannot detect links into ignored/untracked paths** — precisely the class F-21 belongs to | Filter link targets through `git ls-files`; fail on a target that is not tracked | VERIFIED-BY-READING |
| **F-47** | Docs/gates | Both doc-conformance gates exclude the documents that most need them | `scripts/qa/link-check.mjs:28-45`; `scripts/qa/claims-check.mjs:23` | link-check owns only `README.md` + `docs/**/*.md`; claims-check owns only `README.md`, `CONTRIBUTING.md`, `docs/testing.md`. Excluded from both: **`AGENTS.md`**, `CHANGELOG.md`, `CONTRIBUTING.md` (from link-check), `PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md`, `SECURITY.md`, `docs/STATUS.md`. F-16, F-46, F-21 and F-51 are all consequences of these scope holes | Add the missing files to both gates' scope | VERIFIED-BY-READING |
| **F-48** | Arch | Three homes for shared code; `AGENTS.md` points at the legacy one; 75 vs 14 import split | `apps/api/src/lib/{prisma,logger,money,metrics,membership,rateLimitRedis}.ts`; `AGENTS.md:48` | Six `lib/*.ts` files are two-line shims (`// Re-export shim — canonical path:../../infrastructure/database/prisma.js` — note the same missing space after the colon in all six). **75** source/test files import the shims, **14** import the canonical paths. `AGENTS.md` §4 tells agents to "Share through `src/lib/` or `src/shared/`" and **never mentions `src/infrastructure/`**, yet that is canonical for prisma, metrics and rateLimitRedis. Docs cite all three homes inconsistently. A rename that stopped half-way | Finish the migration (or revert it); pick one home per concern; delete the shims; state the rule in `AGENTS.md` §4 | VERIFIED-BY-READING |
| **F-49** | Arch | There is no service layer; the routes are the application | `apps/api/src/modules/*/routes.ts` (4,488 L total) | Only **2** `service.ts` files exist in the API. Route-file sizes: `payments/routes.ts` **911**, `auth/routes.ts` **714**, `marketplace/routes.ts` **513**, `farms/routes.ts` **504**. Handlers contain Zod schemas, Prisma transactions, money math and notification fan-out inline. `import-boundaries.test.ts:113-128` *requires* cross-module access to go **through** `routes.ts`, so any future extraction must unpick handlers first. Business logic is testable only over HTTP | Introduce `modules/<domain>/service.ts` and let `routes.ts` keep wiring + authorisation; decide deliberately whether the boundary rule should permit cross-module service imports | VERIFIED-BY-READING |
| **F-50** | Arch/RBAC | The role vocabulary still has four homes and the guard covers three | `apps/api/tests/role-contract.test.ts:14-20` (its own docblock); `apps/web/src/lib/labels.ts:105-112` | The test's docblock admits the web app writes a **fourth** copy, and the test asserts only the other three. That fourth copy still carries `QC_OFFICER` — a role the same test says the server cannot issue | Extend the guard to `apps/web/src/lib/labels.ts`, or import `contracts/roles.json` in the web build so there is one source | VERIFIED-BY-READING |
| **F-51** | Docs | The module inventory is wrong in both places that state it | `AGENTS.md:50-52`; `docs/architecture.md:127-130` | `ls -d apps/api/src/modules/*/` → **15** (adds `membership` and `ops`). AGENTS.md lists 14 (omits `membership`); architecture.md lists 14 (omits `ops`, which has a live route at `ops/routes.ts:20`). `/ops/retention` is a **data-deletion surface** missing from the module map | Correct both; add a test that the documented module list equals the directory listing | VERIFIED-BY-READING |
| **F-52** | Docs | `docs/generated/` is not a generated directory — it is a 2026-10-19 archive copy with three live files | `docs/generated/*` vs `docs/archive/2026-10-19/generated/*` | 16 of 19 files are **byte-identical** (EOL-normalised md5) to the archive copy — including `final-enterprise-remediation-report.md`, `phase14-security-hardening.md`, `governance-branch-protection.md`. Only `erd.mmd`, `route-matrix.json`, `route-matrix.md` differ. Stale claims inside them: `baseline.md:24` "519 lines identical" (schemas are now 580/583/585 lines); `phase10-db-migration.md:19` "`schema.postgresql.prisma` is prod" (contradicted by `generate-prisma.mjs:17`). `AGENTS.md` §7 declares `docs/generated/**` a generated write path | Move the three generated artefacts to `docs/reference/`, return the archive-only files to `docs/archive/`; fix the `scripts/knip-gate.mjs:33` comment that describes a generator that writes elsewhere | VERIFIED-BY-READING |
| **F-53** | Slop/docs | A tracked document prescribes a dependency the project forbids and describes code that never existed | `docs/generated/phase8-state-cleanup.md:53-63` | Claims *"`@tanstack/react-query@5.64.1` already installed, `queryClient.ts` already configured"*, cites `queryClient.ts:4` and `lib/optimistic.ts:17`, and concludes *"Adopt React Query properly (unanimous directive)"*. Reality: zero references to react-query/tanstack in any manifest; no `queryClient*` file anywhere; `AGENTS.md` §4 says *"There is **no** state-management or data-fetching library … Do not introduce Redux, Zustand, or React Query."* | Delete it, or move it to `docs/archive/` with a header stating it is a rejected proposal | VERIFIED-BY-READING |
| **F-54** | Docs/process | Changelog discipline: 86% of behaviour-changing commits have no changelog entry | `CHANGELOG.md`; `AGENTS.md:119` | Of **144** `feat\|fix\|refactor\|perf` commits, **20** touch `CHANGELOG.md`. In the last 60 commits, **31** behaviour commits have no entry — incl. `7a718c5 (#88)`, `dd58587 (#89)`. Zero `(#NN)` PR citations in 625 lines. `## [Unreleased]` spans lines 5-378 (**60%** of the file) and holds three weeks of shipped production work; the last released heading is `## [1.4.1] - 2026-10-19` | Decide one rule (recommendation: the changelog is a release artefact written at release time, not by every PR) and cite PR numbers; cut the 2026-11-03 release out of `[Unreleased]` | VERIFIED-BY-READING |
| **F-55** | Docs | The ADR index stops at 0016; five ADRs are unindexed and one breaks sort order | `docs/architecture.md:355-370` | The page is titled *"as-built system design **and the ADR index**"*; 21 ADR files exist. Missing from the index: `0017-payment-provider-dual-mode`, `0018-hosting-topology-single-region`, `0019-contract-strategy-and-generated-inventories`, `0020-row-level-security`, `0021-openapi-deferral-and-doc-freshness`. Also `ADR-0001-login-gated-marketplace-catalog.md` vs the `0002-…`–`0021-…` pattern, so `ls docs/adr` puts 0001 last | Index 0017–0021; rename ADR-0001; add a test that `docs/adr/*` ⊆ the index | VERIFIED-BY-READING |
| **F-56** | Docs | Two competing traceability documents; one is orphaned; neither has requirement IDs | `docs/traceability.md` (35 L) vs `docs/qa/test-traceability.md` (76 L) | `grep -rn "docs/traceability"` across `*.md/*.ts/*.mjs` → **0 references**; `STATUS.md:118` points only at the other. Both map capability→tests. Positive: all 48 suite names in `docs/traceability.md` resolve to real files (48/48 verified). Deeper gap: **neither has requirement IDs**, so "traceability" is un-indexable and nothing gates it | Keep `docs/qa/test-traceability.md`; delete or redirect the other; introduce requirement IDs if traceability is to mean anything | VERIFIED-BY-READING |
| **F-57** | DB/security | The demo-credential production guard is keyed only on `NODE_ENV`, and the provisioning script seeds whatever `DATABASE_URL` points at | `apps/api/prisma/seed.ts:48-53`; `apps/api/scripts/provision-postgres.mjs:40` | `const isProduction = env.NODE_ENV === "production";` then `demo = !isProduction \|\| (ALLOW_DEMO_SEED && ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION)`. The provision script runs `npx tsx prisma/seed.ts` after checking only that `DATABASE_URL` starts with `postgres`. **I observed the seed output during the test run: `FARMER: 01700000002 / Demo@1234` … `PROCURMENT: 01700000004 / Demo@1234`.** Demo identities include `SUPER_ADMIN`/`ADMIN` with the public password `Demo@1234` | Refuse to run (or force `NODE_ENV=production` into the child env) when the URL host is not localhost; keep `seedPlan` as the policy | VERIFIED-BY-RUNNING + VERIFIED-BY-READING |
| **F-58** | DB/perf | Eight relation columns have no index, while the project's own doc claims every FK is indexed | `apps/api/prisma/schema.prisma`: `OrderItem.productId` (:282), `Booking.farmId/serviceId/providerId` (:326-328), `ProcurementOrder.farmId` (:352), `FarmEvent.plotId` (:144), `DiseaseCase.cropCycleId` (:189), `AiUsageLog.userId` (:514) — vs `docs/database.md:49-51` *"Foreign keys everywhere … Indexes on all foreign keys and hot filters"* | The `include:` paths that walk these relations degrade to scans as rows grow. **Already confirmed open on 2026-10-18** (`qa-evidence/receipts/2026-10-18-schema-drift-and-release-contract.md` §5: *"confirmed; queued for the DB pass, not fixed here"*); the 2026-10-24 migrations did not address it. The documented invariant is false | One forward migration per chain adding the eight indexes, after `EXPLAIN` (several are low-cardinality today) | VERIFIED-BY-READING |
| **F-59** | DB/migration | `crop_cycle_active_unique` adds a unique index to populated data with no duplicate-retirement step and no recorded row count | `apps/api/prisma/postgres/migrations/20261024000000_crop_cycle_active_unique/migration.sql` (and the SQLite twin) | `CREATE UNIQUE INDEX IF NOT EXISTS "CropCycle_plot_id_active_key" ON "CropCycle"("plotId") WHERE status = 'ACTIVE';` — contrast the sibling `20261024020000_otp_live_challenge_unique`, which **retires duplicates first**. If the race the migration's own comment describes ever produced duplicates in an environment where this has not run, `migrate deploy` **fails** (deploy-blocking, no data loss, manual intervention). Nothing records a pre-flight duplicate count for this one | Before deploying, run the duplicate count query; if any, retire extras in a separate data migration as the OTP migration does | VERIFIED-BY-READING |
| **F-60** | DB/DR | The restore rehearsal provisions a schema production does not run, and the restored copy lacks every migration-only constraint | `apps/api/scripts/backup-restore-rehearsal.mjs:61` — `npx prisma db push --skip-generate --schema prisma/schema.postgresql.prisma` | `db push` is schema-only, so the restored database has **no** `Payment_user_purpose_pending_key`, `CropCycle_plot_id_active_key`, `OtpChallenge_user_purpose_live_key` (partial unique indexes exist only in the migration chains) and no `_prisma_migrations`. Its integrity checks are row counts plus one orphan join. `docs/migrations.md:36` claims the rehearsal *"proves the data layer's logical restore path"* | Provision with `migrate deploy --schema prisma/postgres/schema.prisma` (as `provision-postgres.mjs:34` already does) and assert the three partial indexes + `_prisma_migrations` exist after restore | VERIFIED-BY-READING |
| **F-61** | Docs | The deployment doc names the wrong PostgreSQL runtime schema | `docs/deployment.md:27` vs `scripts/generate-prisma.mjs:17`; `apps/api/scripts/patch-vercel-output.mjs:39` | Doc: *"The PG runtime schema is `apps/api/prisma/schema.postgresql.prisma`"*. Code: `isVercel ? "prisma/postgres/schema.prisma" : "prisma/schema.prisma"`. **An operator following the doc validates and edits the copy production never runs** — precisely the trap the project skill exists to prevent. `docs/generated/phase10-db-migration.md:19` repeats the error | Correct to `prisma/postgres/schema.prisma`; describe `schema.postgresql.prisma` as the auxiliary CI/rehearsal copy | VERIFIED-BY-READING |
| **F-62** | AI/product | Paid tiers advertise "Unlimited AI advisory"; every account is capped at `AI_HOURLY_LIMIT` | `apps/api/prisma/seed.ts:88-89`; `apps/api/src/modules/aiagent/routes.ts:24-39,84` | `{ tier: "SILVER", pricePaisa: 50_000, benefitsStr: JSON.stringify(["Unlimited AI advisory", …]) }` (GOLD likewise) vs a flat `limit: env.AI_HOURLY_LIMIT` (default 30) for all users. `membershipTier` is passed into `AiContext` and read by nothing. A paying member meets `429 RATE_LIMITED` *"AI advisory limit reached for this hour"* — a sold benefit the code does not grant | Implement per-tier limits or remove the claim from the seed/benefit copy | VERIFIED-BY-READING |
| **F-63** | API | Bookings cannot be listed by the roles that can assign them; `channel: "BANK"` carries no account number; product/service lifecycle has no routes | `services/routes.ts:165-171`; `payments/routes.ts:822-825`; `marketplace/routes.ts:96-125` | (a) `const isPrivileged = ["ADMIN","SUPER_ADMIN"].includes(getAuth(req).role)` for `GET /bookings` — `REGIONAL_MANAGER`/`AREA_MANAGER` hold `bookings:assign` and can assign by id but cannot see the queue they must work, so the assign flow is unusable for them. (b) `channel: z.enum(["BKASH","NAGAD","BANK"])` with no account field and `destination: maskDestination(user.phone)` — finance has no account to transfer to. (c) `isActive` is **never written** anywhere in `src` (all occurrences are `where: { isActive: true }` filters), so every such predicate is permanently true and a wrong price can never be corrected or a product retired through the API | (a) attach `bookings:assign`-aware scoping to the list; (b) capture bank account details or drop `BANK`; (c) add lifecycle routes or document the immutability deliberately | VERIFIED-BY-READING |
| **F-64** | API | `GET /farms/:id/events` silently ignores `:id`, and the file's own comment claims the opposite | `apps/api/src/modules/farms/routes.ts:410-425`; comment at `:46-49` | `const where = orgIds.length ? {…} : { farm: { ownerId: userId } };` — `req.params.id` is never read. The route is named and documented as farm-scoped (`docs/route-role-matrix.md`), but returns the caller's events across **all** their farms for any id, including an id they do not own, which never 404s. Not a leak (still owner/org-scoped) but a lying contract and a dead parameter. `tests/farm-event-sync-scoping.test.ts:43` passes the caller's own farm id, so it cannot catch this | Add `farmId: req.params.id` to the predicate, or scope the router and drop the claim | VERIFIED-BY-READING |
| **F-65** | Governance | `docs/STATUS.md` reports `main` as unprotected — a false negative that inverts an owner action | `docs/STATUS.md:101` vs ruleset `25297401` | Doc: *"The GitHub API reports **no protection configured** (`GET /repos/…/branches/main/protection` → 404, checked 2026-11-03) … as written, a force push to `main` succeeds and the merge gate is convention, not enforcement."* I reproduced the 404 (legacy endpoint) **and** read back the ruleset: `main — protected`, `enforcement: active`, `deletion` + `non_fast_forward` + `required_linear_history` + `pull_request` (approvals **0**) + 11 required status checks, `bypass_actors: []`. The repo's own `docs/generated/governance-branch-protection.md:3-6` explains rulesets vs the legacy API | Re-probe `…/rulesets/25297401` instead of `…/branches/main/protection`; correct STATUS.md and cross-reference the governance doc. **This finding is in the repo's favour** — the control is stronger than documented | VERIFIED-BY-RUNNING |

---

## 6. Findings — P3 (Low)

*36 findings. Polish, dead code, cosmetic drift and cheap wins.*

| ID | Domain | Title | Evidence (file:line) | Fix direction | Conf |
|---|---|---|---|---|---|
| **F-66** | QA/tooling | `npm run qa:knip` **cannot run** — a declared gate that never executes | `scripts/knip-gate.mjs` — `RangeError: Array buffer allocation failed` (oxc-parser), 0-byte output, reproduced twice including with an 8 GB heap | Determine whether the cause is the Node-24 ambient pin or `oxc-parser`/`knip` versions; re-run on Node 22 before trusting it. CI reports green | VERIFIED-BY-RUNNING (cause NOT DETERMINED) |
| **F-67** | Slop/deadcode | The unused-export bucket is excluded from the dead-code gate by design; 19 dead exports found by hand | `scripts/knip-gate.mjs:63` — `--exclude types,nsTypes,exports,nsExports`; `knip.jsonc:20-22` | Land the SLP-02 cleanup (9 of the 19 are the documented api-types contract surface) then drop `exports`/`nsExports` from `--exclude` | VERIFIED-BY-READING |
| **F-68** | API/contract | Four web-consumed response shapes are guarded only top-level (vacuous element assertions), and five web-consumed endpoints are not in the fixture | `contracts/api-response-shapes.json` — `"items[]: array(empty)"` for cart, `disease/cases`, `payments`; missing entirely: `POST /payments/intent`, `POST /ai/advisory`, `POST /payments/:id/status`, `GET /admin/analytics/summary`, the login/register session shape | Seed a cart item after the probes' mutations; add the five probes; make "every endpoint the web consumes" a checked list rather than a hand-maintained array | VERIFIED-BY-READING |
| **F-69** | API/docs | Contract docs in the web app contradict the API's current behaviour | `apps/web/src/lib/api-types.ts:35-38` — *"rate-limiter rejections (429) return only `{ok:false, error:{code,message}}` — no requestId, no reference"* | False today: `rateLimitHandler` calls `fail()`, which always sets `requestId` (`tests/rate-limit-envelope.test.ts:36-38` asserts it). Fix the comment; also `Login.tsx:41`/`Register.tsx:54` re-inline `api<{accessToken…}>` instead of importing `AuthSession` | VERIFIED-BY-READING |
| **F-70** | API/contract | Status-code and envelope nits | `admin/routes.ts:116,150` (`400` instead of `404`); `marketplace/routes.ts:162-167` (`upsert` always answered 201 even when it updated); `analytics/routes.ts:42` (hand-rolled `res.status(202).json({ok:true,…})` instead of `ok(res, …, 202)`); `app.ts:135` (`/ready` 503 branch returns no `error` object, so a client using the standard envelope finds no `error.code`) | Fix opportunistically — they are cheap | VERIFIED-BY-READING |
| **F-71** | API/obs | Admission-control shedding is a log line, not a signal | `middleware/admission.ts:41-51,69-71` — `shed++` then `logger.warn`; `admissionStats()` has **no production caller** | A device under overload sheds requests with no counter to alert on; 503s surface only as `route="unmatched",status="503"` (F-26). Add `agrobridge_requests_shed_total` next to `shed++` | VERIFIED-BY-READING |
| **F-72** | API/audit | Audit coverage is inconsistent with the stated policy | `organizations/routes.ts` (**0** `audit()` calls), `farms/routes.ts` (**0**), `services/routes.ts` (**0**), vs `marketplace/routes.ts:119` auditing `PRODUCT_CREATE` | Creating an organisation, adding/removing members (which grant access to farm data — see F-06), deleting a farm and booking status changes leave **no trail**, while a product insert does. Member removal in particular is undetectable after the fact | Audit the org-membership mutations and farm delete; document which mutations are deliberately unaudited | VERIFIED-BY-READING |
| **F-73** | API/obs | Parser-level errors escape the correlation contract | `app.ts:74-78` — `app.use(express.json({limit:"1mb"}))` … then `app.use(requestContext)` | `express.json()` calls `next(err)` for bad JSON/oversize, skipping every middleware including `requestContext`, so `errorHandler` writes `requestId: undefined` and sets no `X-Request-Id`. **Verified live:** malformed JSON → `400 INVALID_JSON` with `x-request-id: null`. Every other error path carries it | Mount `requestContext` before the body parsers, or generate an id inside `errorHandler` when `req.requestId` is absent | VERIFIED-BY-RUNNING |
| **F-74** | API | Two validators for one `Idempotency-Key`, with different bounds | `middleware/idempotency.ts:24` — `/^[\x21-\x7e]{8,100}$/` vs `middleware/context.ts:103` — `/^[\x20-\x7e]{8,128}$/` | The same header is 8–100 non-space chars in one place and 8–128 chars-allowing-space in the other; `idempotencyKeyOf`'s wider bound is unreachable on the routes that mount the mapper, so a 101–128 char key is 400 while `context.ts:97` documents 128. Delete one validator; keep the stricter bound in a single exported helper | VERIFIED-BY-READING |
| **F-75** | API/policy | Separation of duties is not applied to withdrawal decisions or refunds, contrary to the project skill | `lib/separationOfDuties.ts:36-43` (only caller `payments/routes.ts:686`); `payments/routes.ts:564-567`; `admin/routes.ts:221-224` | The skill states refunds and withdrawals are *"permission-gated **and** separation-of-duties enforced"*; `docs/business-rules.md` BR-33/BR-30 document a single permission. Not exploitable without a live gateway (the operator must first issue the real refund) and the docs contradict the skill — **a question, not a verdict**. Decide the policy; if SoD applies, add `assertNotSelfDealing(actor, payment.userId, …)` to both routes | VERIFIED-BY-READING |
| **F-76** | API/deadcode | The sandbox adapter ignores the `forceFail` hook its own comment promises | `providers/payment/sandbox.ts:5-18` — comment *"Succeeds unless `input.forceFail` is set"*; `createPayment` never reads it | `forceFail` exists in the contract (`payment/types.ts:11`, "deterministic outcome for testing both paths") and is read nowhere in `src` or `tests`, so the documented negative path is unreachable and untestable. Implement it or delete the field and the comment | VERIFIED-BY-READING |
| **F-77** | Config/security | `NODE_ENV` defaults to `development`, which auto-verifies phones and echoes OTP codes | `config/env.ts:5` — `.default("development")`; `auth/routes.ts:230,532,582` — `phoneVerified: !isProd`; `...(isProd ? {} : { devCode: … })` | A deployment that forgets `NODE_ENV=production` gets auto-verified accounts and OTP codes in API responses. Documented as dev behaviour and reachable only via operator error — but the failure mode is "OTP bypass" | Make the override explicit (`DEV_AUTH_SHORTCUTS=1`) or fail startup when `NODE_ENV` is unset and a public URL is configured | VERIFIED-BY-READING |
| **F-78** | DevOps/docs | Two hostnames for one API across the delivery path, with no single source of truth | `ci.yml:238,457` and `apps/web/.env.production:1` use `agro-bridge-api-vantiq-systems.vercel.app`; `deploy-verify.yml:37` and `uptime-probe.yml:36` poll `agro-bridge-api.vercel.app`; `docs/runbooks/live-deployment.md:8` and `STATUS.md:27` name only the team-scoped one; `vercel.json:13` lists both in `connect-src` | I settled this: both hosts return `200 … "commit":"d205f76","env":"production"` — they are aliases of one project, so the gates check the right service. The exposure is operational: a future CSP or allow-list edit must touch two names | Pick one host as canonical (the team-scoped one) and use it in both workflows and both docs | VERIFIED-BY-RUNNING |
| **F-79** | Repo/process | `AGENTS.md` is untracked, and the audit working directories are hidden only in a machine-local exclude file | `AGENTS.md` (`?? AGENTS.md`); `.git/info/exclude:9-11` | The project's own instruction file is outside the reviewed artefact, is absent from a fresh clone, and is outside both doc gates — **and it contains the verified-wrong path in F-16**. `.audit/`, `.audit-archive/` and `.agent-evidence/` are excluded by `.git/info/exclude`, which is not cloned and not reviewed; CI's hygiene gate (`ci.yml:738-762`) inspects only tracked files, so it can never see any of this | Track `AGENTS.md`; move the three audit-directory rules into `.gitignore` with reasons | VERIFIED-BY-RUNNING |
| **F-80** | DevOps/docs | `docs/operations.md` publishes alert names and a threshold that do not exist | `docs/operations.md:44-62` vs `monitoring/alert_rules.yml` | Doc names `AgroBridgeHigh5xx`, `AgroBridgeHighLatency`, `AgroBridgeDbDown`, `AgroBridgePaymentFailures`, `AgroBridgeAiProviderErrors`; the real names are `High5xxRate`, `ApiHighLatencyP95`, `DbDown`, `PaymentFailures`, `AiFallbackSpike`, `InstanceDown` (and `InstanceDown` is missing from the doc). The AI rule also differs: `[10m]) > 20` in the doc vs `[15m]) > 10` in the file. `docs/slo.md`'s mapping uses the correct names. An operator copying the snippet creates six duplicate, differently-named rules | Link to `monitoring/alert_rules.yml` instead of duplicating it; extend the claims gate to cover rule names | VERIFIED-BY-RUNNING |
| **F-81** | DevOps/docs | `docs/slo.md`'s alert-mapping caveat is stale in the opposite direction | `docs/slo.md:11-14,51-59` vs `grep -n "runbook:" monitoring/alert_rules.yml` | Doc says five of six rules lack a `runbook:` annotation; **all six carry one**. A doc defect that *understates* the alerting posture — the kind of stale claim `claims-check.mjs` exists to prevent | Delete the caveat and the "Missing links" note; keep the SLO/threshold mapping | VERIFIED-BY-RUNNING |
| **F-82** | DevOps/config | `AI_MONTHLY_BUDGET_PAISA` has a **10×** divergence between the code default and the template | `apps/api/src/config/env.ts:131` (`default(500_00)`) vs `.env.example:105` (`AI_MONTHLY_BUDGET_PAISA=500000`); both shown in `docs/env-reference.md:45` | An operator reading the template believes the cap is ৳5,000; an unset deployment gets ৳500. `.env.example:190-193` documents a previous instance of exactly this class of bug (AUD-108) | State one number in both places, or make the template comment state the divergence explicitly | VERIFIED-BY-READING |
| **F-83** | DevOps/docs | Chaos-drill and deployment docs contain commands that cannot run | `docs/runbooks/chaos-drills.md:66-68,89-93`; `docs/deployment.md:57-59` | Drill 3 writes `dd … of=/app/uploads/filler`, but the mount is `uploads:/app/apps/api/uploads` (`docker-compose.prod.yml:56`) and the image pre-creates `/app/apps/api/uploads/disease` — `/app/uploads` does not exist and the container runs as `node`. Drill 2 suggests `image: ghcr.io/shopify/toxiproxy:latest`, a floating tag contradicting the repo's own pinning rule. `docs/deployment.md:57-58` repeats the same `up --build -d` line twice. Two runbooks a responder would reach for mid-incident | Correct the paths; reference a digest-pinned toxiproxy | VERIFIED-BY-READING |
| **F-84** | DevOps/hygiene | `.dockerignore` misses the release binaries and audit directories that sit at the repo root | `.dockerignore` | Excludes `node_modules`, `.git`, `.github`, `docs`, `*.md`, `apps/web/dist`, `*.log`, `.env*`, `*.db` — but **no** `*.apk`, `.audit*`, `.agent-evidence`, `qa-evidence`, `qa-screenshots`, `jscpd-report`, `New folder`, `tmp_*.mjs`. CI is unaffected (those paths are untracked) but any local `docker build` drags ~130 MB — including four signed-release-era debug APKs — into the build context and the web builder layer | Add `*.apk`, `.audit*/`, `.agent-evidence/`, `qa-*/`, `jscpd-report/`, `New folder/`, `tmp_*.mjs` | VERIFIED-BY-RUNNING |
| **F-85** | DevOps/CI | Missing concurrency groups on the Android workflows and CodeQL | `android-debug-apk.yml`, `android-release.yml`, `codeql.yml` (absent) vs `play-upload.yml:31-33` (present) | Two simultaneous dispatches of `android-release` build the same `versionCode` against the same keystore with no mutual exclusion (the Play-facing half is serialised, the build half is not); weekly CodeQL plus a push can run two analyses concurrently. Low but free to fix | Add `concurrency:` blocks | VERIFIED-BY-RUNNING |
| **F-86** | DevOps/supplychain | 33 dependabot refs, none merged, oldest 76 days — one proposes `node-25-alpine`, contradicting the Node 22 pin | `.github/dependabot.yml`; `git branch -a` | Newest-commit dates run 2026-08-26 → 2026-10-28, i.e. through the release-stabilisation window. Includes `dependabot/docker/docker/node-25-alpine`, `types/node-26.2.0`, `vite-8.3.4`, `vitest-5.0.5` — all majors, all contradicted by `CONTRIBUTING.md` §Dependency policy. `dependabot.yml` has no `open-pull-requests-limit` and no major-version ignores | Close or merge each with a written reason; add `open-pull-requests-limit` and major ignores for the docker ecosystem during stabilisation | VERIFIED-BY-RUNNING |
| **F-87** | DevOps/config | `docker/web.nginx.conf` is dead config that contradicts the shipped one and silently drops inherited security headers | `docker/web.nginx.conf:9-11,27-30`; `docker/web.Dockerfile:23`; `docker-compose.yml:80-88` | The web image bakes `web.nginx.prod.conf` and compose mounts nothing, so this file is reachable only from `docs/deployment.md:50`. It sets `Referrer-Policy strict-origin-when-cross-origin` where prod/Vercel use `no-referrer`, has no CSP, and its asset `location` block adds `add_header Cache-Control` — under nginx a location-level `add_header` **cancels the inherited server-level ones**, so those responses ship without `X-Content-Type-Options`, `X-Frame-Options` or `Referrer-Policy`; `expires 7d` also emits a second `Cache-Control` | Delete it, or make it a documented superset with `add_header` repeated in the location block | VERIFIED-BY-READING |
| **F-88** | DevOps/supplychain | The dependency install-script allow-list cannot be assumed active in CI, and the compensating step cannot fail | `package.json:38-44`; `.nvmrc`; `ci.yml:42-45,365-368` | `"allowScripts"` is an **npm-11** configuration surface (confirmed: `npm config ls -l \| grep allow-scripts` lists it on npm 11.17.0); CI installs Node from `.nvmrc` (=22) whose bundled npm is 10.x. CI's actual defence is `npm config set ignore-scripts false \|\| true` followed by `npm rebuild @prisma/engines prisma esbuild 2>/dev/null \|\| true` — a step that cannot fail | Pin the runtime (`engines.npm` / `packageManager`) so CI and local agree; replace the `\|\| true` rebuild with an asserted step; state the allowed-script set once. **NOT DETERMINED:** whether npm 10 honours `allowScripts` (I did not run `npm ci`) | VERIFIED-BY-RUNNING + NOT DETERMINED |
| **F-89** | Docs | `docs/generated/` mixing means "generated" no longer implies fresh, and `docs/api.md` points at a file that does not exist | `docs/api.md:1` — *"regenerated inventory in docs/qa/route-matrix.md"*; real path is `docs/generated/route-matrix.md`. See F-52 for the archive-copy problem | Fix the path; only genuinely regenerated artefacts belong in `docs/generated/` | VERIFIED-BY-READING |
| **F-90** | Slop | `tmp_fix_routes.mjs` — a 596-line generator at the repo root that writes the largest, most money-critical source file, with a now-stale payload | `tmp_fix_routes.mjs:594` — `writeFileSync('C:/Users/DST/projects/Agro bridge app/apps/api/src/modules/payments/routes.ts', content, 'utf8')`; line 5 emits `import … from "../../lib/errors.js"`, **a path that no longer exists** (it is `shared/errors/index.js`) | The 911-line `payments/routes.ts` has no verifiable authorship and sits next to the emitter, whose payload no longer matches the tree. Any execution overwrites the money-path route file with a non-compiling historical revision. **The repo's own audit logged this as `AUD-204`/`SLOP-19` and left it OPEN** | Delete it; confirm `routes.ts` is the hand-maintained source; then split the three routers it defines | VERIFIED-BY-READING |
| **F-91** | Slop | Six shim files carry one mechanically stamped comment with the same typo | `apps/api/src/lib/{metrics,rateLimitRedis,prisma,logger,money,membership}.ts:1` — all six read `// Re-export shim — canonical path:../…` (missing space after the colon in all six) | The identical defect replicated six times is the fingerprint of a bulk write rather than six considered edits. Fold into F-48's fix | VERIFIED-BY-READING |
| **F-92** | Slop/tests | Progressive-round test filenames document iterations rather than behaviour | `hardening-round11.test.ts`, `round10-regressions.test.ts`, `rbac-fixes.test.ts`, `misc-hardening.test.ts`, `auth-hardening.test.ts`, `disease-upload-hardening.test.ts`; migration `20260826092539_hardening_features` | "round10"/"round11"/"misc" are meaningless to a future reader; coverage ownership is unassignable and `misc-hardening` will accrete unrelated cases. **Mitigating:** I checked every pairing — the *contents* are well-scoped and behaviour-named (e.g. *"a malformed Idempotency-Key header is a 400, not silently ignored"*); only one genuine near-duplicate exists (`hardening-round11.test.ts:25` vs `misc-hardening.test.ts:7`) | Merge into domain-named suites; do not create round-12 | VERIFIED-BY-READING |
| **F-93** | Slop/docs | Same concept, two Bengali words, on the same screen | `apps/web/src/lib/i18n.ts:14` — `myFarm: { bn: "আমার ফার্ম" }` vs `:523` — `myFarmListTitle: { bn: "আমার খামার তালিকা" }` | Counts: ফার্ম in **15** keys, খামার in **7**. `docs/web-glossary.md:4` claims the glossary fixes *"WHICH word a concept maps to, so the same English idea **never oscillates** between two Bengali words across screens"* — falsified by its own repository. Two glossaries give **contradictory** canonical terms (Farm → খামার vs ফার্ম; Plot → জমির প্লট vs প্লট; Crop cycle → ফসলের চক্র vs চলমান ফসল); the newer `glossary-bn-en.md:12-13` is the honest one and flags both the conflict and that *"none of the farmer-facing copy has been reviewed by a native speaker yet"* | Delete or supersede `docs/web-glossary.md`; resolve ফার্ম/খামার once and apply it across all 22 keys as part of the native-speaker review | VERIFIED-BY-READING |
| **F-94** | Slop/structure | Largest source file hosts three routers | `apps/api/src/modules/payments/routes.ts:24-26` — `paymentsRouter`, `walletRouter`, `membershipRouter` in one 911-line file, with `// ----------------` banners at :550, :752, :818, :886 | Three domains in one file defeats the module boundary enforced everywhere else and makes the file the hottest merge target. Split wallet + membership out | VERIFIED-BY-READING |
| **F-95** | Repo hygiene | ~167 MB of untriaged agent working artefacts, including 32 MB of APKs and 26 SQLite databases | Root: 4 debug APKs (7.4 + 8.0 + 8.2 + 8.5 MB), `tmp_fix_routes.mjs` (23 KB), `api-full-validation.sh` (27 KB, superseded by the tracked `scripts/qa/full-functional-sweep.mjs`), 4 **zero-byte** `server-{out,err}{,2}.log`, `New folder/` with 8 untitled JPGs. `apps/api/prisma/`: **26** `.db` files (`audit-*.db` ×19, `dev.db`, `e2e.db`, `test.db`, `acceptance.db`, `verify.db`), several holding real data. Evidence dirs: `.audit` 14 MB / `.audit-archive` 30 MB / `.agent-evidence` 30 MB / `qa-evidence` 45 MB | **This is not a new finding: a VERIFIED audit on 2026-08-09 listed exactly these paths and it is still open three months and ~15 audit rounds later** — see §7.3. Delete the APKs, empty logs, `tmp_*.mjs`, `New folder/`; keep one audit directory; close `AUD-204` | VERIFIED-BY-RUNNING |
| **F-96** | Docs | Two Trivy ignore files and two `CODE_OF_CONDUCT.md` files at different paths | `.trivyignore` (705 B, 2026-10-18) + `.trivyignore.yaml` (2,183 B, 2026-11-03); `CODE_OF_CONDUCT.md` (root, 28 L) + `docs/CODE_OF_CONDUCT.md` (141 L, Contributor Covenant 2.1) | Two formats/dates for waiver provenance that `SECURITY_WAIVERS.md` must be manually kept in sync with; two codes of conduct, one authoritative by accident of GitHub's lookup. Consolidate on one of each | VERIFIED-BY-READING |
| **F-97** | Web | Dead custom CSS, one piece of it dark-mode-maintained | `index.css:188-194` + `dark.css:140-146` (`.bg-dot-pattern`), `index.css:231` (`.touch-target`), `tokens.css:223-224` (`.animate-success-pulse` + `@keyframes agro-pulse`) | Zero references in `src/**/*.tsx`. The preflight dead-class gate only checks *used class → CSS exists*, never the reverse | Delete, or add the reverse scan to the gate | VERIFIED-BY-READING |
| **F-98** | Web | A stale a11y exclusion whose comment describes a UI that no longer exists | `e2e/a11y.spec.ts:24-33` — `builder.exclude("form div.rounded-md.bg-stone-50")` justified as *"demo-credentials hint rendered only under `import.meta.env.DEV`"* | No `demo`/`Demo@`/`bg-stone-50`/`rounded-md` string exists in `src/features/auth/**`, so the exclusion is dead and the comment is false. Same class: `lib/build-info.ts:2-3` names `scripts/stamp-build.mjs`, which does not exist (the emitter is the inline `agrobridge-build-stamp` plugin, `vite.config.ts:55-66`) | Delete the exclusion; fix the comments | VERIFIED-BY-READING |
| **F-99** | Web/i18n | Success toasts print a tick **and** carry "✓" in their copy; five strings use `...` where the house style is `…` | `i18n.ts:135,218,240,243,514-516,559,566,671` (tick) vs the in-source comment at `:695-697` (*"ToastProvider already renders the success tick as an icon … the emoji drew a second one"*); `i18n.ts:41,57,424,588-589` (`...`) | The project removed the glyph from two keys for exactly this reason and left ten. Strip the glyph; use `…` | VERIFIED-BY-READING |
| **F-100** | Web | `transition-all` in two places, and the photo-upload focus ring is Tailwind's default blue while `peer-focus-visible` is inert | `features/home/Home.tsx:46`, `features/onboarding/Onboarding.tsx:63` (`transition-all` animates every property incl. layout); `features/advisor/Advisor.tsx:253` — `focus-within:ring-2 peer-focus-visible:ring-[var(--ring-color)]` | `peer-*` only matches *sibling* peers and the input is a **child**, so the ring colour/offset never applies — WCAG-adjacent. Use `transition-[stroke-dashoffset]`/`transition-[width]`; use `focus-within:ring-[var(--ring-color)] focus-within:ring-offset-2` | VERIFIED-BY-READING |
| **F-101** | Docs/AI | The document that commissions the agronomist review misdescribes the corpus | `docs/agronomy-review-sheet.md` §1 | Quoted: *"seven hand-authored bilingual entries … (ids: **rice blast, rice stem borer, wheat rust, potato late blight**, jute stem rot, mustard aphid, plus the two general entries)"* — that list names **8** ids, two of which (`rice stem borer`, `potato late blight`) **do not exist** in `KNOWLEDGE_BASE`, and omits `rice-urea`. No gate covers this file (`kb-coverage-doc.test.ts` parses only `docs/kb-coverage.md`) | A reviewer signs off a sheet whose scope is not the shipped corpus. Correct the id list and gate the doc | VERIFIED-BY-READING |

**Additional P3 items folded into the tables above rather than given separate IDs** (each verified, each cheap): `admin/routes.ts:307` refers to *"the audit-logs route **below**"* while `/admin/audit-logs` is at `:158`, above it; `payments/routes.ts:328` and `admin/routes.ts:328` have de-indented `ok(res, {` lines; `payments/routes.ts:782-783` has a mid-file `import` + re-export block; `index.html:11` has `<link rel="maskable" href="/icons/icon-512.png" />` — not a valid link relation (maskability belongs to the manifest, which already declares it); `manifest.webmanifest:7` `"background_color"` is near-white and contradicts the deliberate `#0a2f1f` splash handover, reintroducing the blank first paint that `index.css:153-165` exists to remove; `lib/publicLanguage.tsx:25` vs `components/Splash.tsx:15` duplicate the `agrobridge.auth_lang` storage key as a literal; `components/icons/AgriIcons.tsx:31,36,52` has a `case "COMBINE_HARVESTER"` fallback for an icon that does not exist, `MetaIcon` with no caller, and `withMotion` defaulted `true` but only ever passed `false`; `lib/analytics.ts:19,36-58` buffers events in memory that survive sign-out and flush under the next account's token; `lib/useResource.ts:132` freezes already-rendered error text in the language it was fetched in; `lib/api.ts:415-437` `apiBlob` has no timeout and two unreachable `instanceof NetworkError` branches; `lib/sessionManager.ts:198-206` re-reads `localStorage` on every call (twice per request) while its comment claims otherwise; `features/orders/MyOrders.tsx:97-100` is the structural odd one out (own `h1` instead of `PageHeader`, legacy `green-*` aliases instead of semantic tokens); selects use the field label as the empty option's text (four sites); `docs/generated/*` contains 14 ungated hand-written reports with zero code references.

---

## 7. What is genuinely good — verified strengths

A professional audit that reports only defects is not an audit. The following were **tested adversarially and held**.

### 7.1 Money path — I tried to break it and could not

1. **Integer paisa is real, everywhere.** Every monetary column in all three schema copies is `Int` paisa (`pricePaisa`, `subtotalPaisa`, `amountPaisa`, `balancePaisa`, `heldPaisa`, `balanceAfterPaisa`, `netPayablePaisa`, `costEstimatePaisa`); **zero** `Float`/`Decimal` money fields. Validators use `z.number().int()`. The contract fixture records every money field as `number`. Every `Paisa` arithmetic expression is integer × integer; the only fractional multipliers (bigha area, moisture, grade) are wrapped in `Math.round` **once**, inside shared helpers (`shared/utils/money.ts:46,48,65`).
2. **Atomic claim predicates everywhere state changes.** Cancel, refund, payout, booking transitions, rating, disease review, procurement transitions and withdrawal decisions all use `updateMany` with the expected current state in the `WHERE` and check `count !== 1`. Races lose rather than double-apply.
3. **Checkout idempotency is designed, not asserted.** Composite unique (`@@unique([userId, clientRequestId])`) + cart-rows-as-token claim + keyed replay + lost-race replay, with the "one key = one order" contract pinned by tests (`checkout-idempotency-key.test.ts`).
4. **The wallet is ledger-based**, with a `WalletTransaction` ledger carrying `balanceAfterPaisa`, `heldPaisa` maintained under a row lock, a daily reconciliation script that checks balances **and** holds, and tests showing clean/polluted/repaired states.
5. **No double-spend was found** despite targeted attempts on withdrawal holds, payout claims and refund paths.

### 7.2 Security engineering that is real, not theatre

1. `requireAuth` **re-reads status and role from the database on every authenticated request** via a bound-parameter tagged template, refuses non-`ACTIVE` accounts, and is followed by a `payload.sub` type check (`middleware/auth.ts:19-69`). I checked every `getAuth(` call site: **no file reads it without `requireAuth`**, and `getAuth()` throws 401 rather than 500 if a route forgets the guard.
2. JWT verification pins `algorithms: ["HS256"]` and `issuer`. Login is timing-equalised through a bcrypt worker pool with a cost-matched dummy hash and a DB-backed per-account lockout; throttle keys are **salted hashes** (no PII at rest). Registration and password-forgot are enumeration-neutral. Refresh rotation uses an atomic single-claim with family revocation on reuse.
3. **Production refuses to boot** with placeholder JWT secrets, secrets under 32 characters, placeholder providers without an explicit flag, a hosted AI provider with `AI_COST_PER_1K_TOKENS_PAISA=0` (the budget breaker would be inert), `sslcommerz` without credentials, `s3` without credentials, or `http` SMS without URL/key (`config/env.ts:239-296`) — each extracted into a unit-testable pure function.
4. **Uploads are genuinely defensive**: declared MIME ignored in favour of full magic-byte sniffing, an 8 MB cap enforced while streaming, EXIF/XMP stripped before storage, UUID filenames, purge-on-failure plus a retry queue that reports `pendingPurge` honestly instead of pretending success.
5. **No user-controlled URLs fetched server-side** (no SSRF), no shell execution, **no raw SQL built from input** (`$queryRawUnsafe` at `infrastructure/schemaState.ts:32` is a constant string), no Zod `passthrough`, and KB retrieval text is delimited as untrusted reference data.
6. **The webhook is well built** apart from F-02: constant-time signature comparison, amount **and** currency cross-checks, `providerRef`/`val_id` separation, "never branch on client status", and a browser return path that provably cannot confirm without a provider verdict.
7. **Edge/supply chain**: helmet + a CORS allow-list that strips dev origins in production; **all 19 unique GitHub Action refs SHA-pinned** with trailing version comments; base images digest-pinned; `.dockerignore` excludes `.env*` and `*.db`; four Vercel security headers asserted live by `deploy-verify.yml`. Anonymous `/metrics` returns **403** in production — verified.
8. `npm audit --omit=dev` → **0 vulnerabilities**; lockfile `lockfileVersion 3`, 1117 packages, all registry-resolved with `integrity`.

### 7.3 Data layer strengths

1. **Cross-dialect parity is guarded by a real parser, not regexes.** `tests/schema-parity.test.ts` compares scalar types, optionality, arrays, `@unique`, `@default`, full attribute multisets (which catches `@relation`/`onDelete` drift), relations, and `@@unique`/`@@index` sets across all three schema copies — **with anti-vacuity self-checks** at lines 463-506. My own `diff -u` confirmed the only real differences are the allowlisted `provider`/`binaryTargets` lines.
2. **Both migration chains have content-level drift gates.** CI applies the real chain to an empty PostgreSQL 17, asserts `migrate status` is clean, and runs `migrate diff --from-url … --to-schema-datamodel … --exit-code` — a genuine content diff, not a hash. This is what caught production drift on 2026-10-16.
3. **Migration history discipline:** every migration in both chains was added and never modified (git shows `A` only). Several carry unusually good comments — the deploy-order rationale for nullable `updatedAt`, the duplicate-retirement rationale for the OTP index, the race description for the crop-cycle index.
4. **Enum discipline is largely exemplary:** the 13-role string vocabulary is identical across the schema comment, `VALID_ROLES`, `contracts/roles.json`, `middleware/rbac.ts`, and the web labels; there are **zero native enums** in any schema, as the project requires.
5. **Generated documents are genuinely freshness-gated byte-for-byte:** `route-matrix --check` → *"up to date (86 routes)"*; `gen-erd --check` → *"up to date (33 models)"*; `generated-docs-freshness.test.ts` re-renders `docs/env-reference.md` and `docs/erd.md` and compares byte-wise, with non-vacuity assertions (≥35 env rows, ≥25 models).
6. **Retention and deletion are implemented, tested and honestly documented** — eight categories with an injectable clock and drain, plus `data-protection.md:60-70` listing residuals rather than claiming completeness.

### 7.4 Frontend strengths

1. **The state model is real.** `useResource` gives every panel its own loading / refreshing / error / settled lifecycle with request-sequence guarding, and the features use it consistently. "A failed read is not an empty state" is implemented pervasively, not asserted.
2. **Zero lint warnings, zero `any`, strict TS clean** — measured, not claimed. Only 8 non-null assertions in the whole app.
3. **A11y engineering beyond the checklist**: focus trapping with `inert` on the app chrome, scroll-lock preserving scrollbar width, focus restore, `role="log"` for the advisor transcript, 44 px touch targets, `MotionConfig reducedMotion="user"` plus a blanket reduced-motion block, and an axe gate that scans 12 routes **including dark mode and an error state** with critical/serious as build-blockers.
4. **Design-token discipline enforced by a gate**: all hex is confined to `tokens.css`/`dark.css` with a single allowlisted literal, duotone icons use `var()` so they survive dark mode, and a dead-class scanner reads the **compiled** CSS.
5. **Route-level code splitting works**: every page is a lazy chunk (3–64 KB), only Login is eager, entry is 129.6 KB gzip, and the market grid uses `content-visibility: auto`.
6. **Truthfulness engineering is visible in the UI**: `aiFarmEmpty` vs `farmDataUnavailable`, `unreadCountUnavailable`, weather provenance ("as of" + cached-copy labelling), sandbox-mode disclosure rendered **only** from the server's `providerMode`, and `PENDING_REVIEW` disease photos that never claim a diagnosis.

### 7.5 AI-layer strengths

1. **Retrieval is genuinely deterministic**: no `Date.now`/`Math.random`, no `Map`/`Set` iteration-order dependence, no locale collation, stable sort with an index tie-break, corpus compiled once, no I/O. `kb-reproducibility.test.ts` and `ai-retrieval-regression.test.ts` are **not vacuous** — they assert `KNOWLEDGE_BASE.length >= 7`, per-entry `titleBn`, hash sensitivity to answer/confidence/provenance edits, concrete entry ids, and the joiner-collapsing property.
2. **Bangla handling is real**: `য়` U+09DF ↔ য+নুক্তা unification and hasanta/ZWJ stripping applied symmetrically to query and keyword, deliberately documented and tested.
3. **Provenance cannot be fabricated**: every entry `UNSOURCED` with a null source ledger, citations resolved against the live corpus at read time, the citation shape has **no URL field**, and a test asserts no `https?://` appears anywhere in the citation payload.
4. **Failure taxonomy is honest**: `EMPTY_CONTENT`/`CONTENT_FILTERED`/`TRUNCATED` become typed errors, never answers. In production a provider failure returns **502 rather than silently degrading to canned text** — documented, and the right call.
5. **The eval harness genuinely runs and can genuinely fail.** Measured by the lead auditor: `PASS`, 10/10 metrics at floor (hitRate/containment/abstention/clarify/language/safetyReferral all 1.0; citationValidity/fallbackCorrectness/abstentionPrecision 1.0; latencyP95 0.343 ms). Injected-degradation proof, reproduced in the isolated suite run: empty corpus → `Gate: FAIL (4 breach(es))`; single-entry corpus → `Gate: FAIL (4 breach(es))`. So the gate is real, not decorative.
6. `docs/ai-parameters.md` labels each tunable measured/tuned/guessed; `docs/kb-coverage.md` states *"No national coverage claim"*.

### 7.6 QA strengths

- **No disabled tests.** `.only`, `it.todo`, `xit`, `xdescribe` → **0 occurrences**. `process.env.CI` never disables an assertion in tests.
- **No assertion-swallowing.** All six `try/catch` sites are helper plumbing or Windows file cleanup; no bare `return;` before assertions.
- **Shape:** 110 API files / 590 tests; 27 web files / 214 tests; 22 e2e specs / 96 tests. API tests 13,546 LOC vs API src 10,013 LOC (**ratio 1.35**).
- **"Hardening round N" files are well-scoped, not a dumping ground** — I checked every pairing; only one genuine near-duplicate exists across 541 titles.
- **Money/auth/state coverage is genuinely deep**: withdrawals (hold, availability, below-min, double-APPROVE rejected, N-parallel over-commit), refunds (farmer 403, double-refund conflict), webhook (invalid signature rejected without leaking internals, superseded no-op, replay idempotent), SoD, territory, IDOR/tenant, race conditions, ReDoS/prototype pollution.
- **Time is properly pinned**: `timezone-boundaries.test.ts` asserts exact Dhaka instants and the mock provider is pinned to `MOCK_REFERENCE_NOW` — no wall-clock dependence.
- **Determinism:** my local web coverage reproduces CI's to **0.04 pp** (43.36/33.25/39.97/44.91 vs 43.36/33.21/39.97/44.91).
- **Flake honesty:** `docs/qa/flake-register.md` is real — dated entries, re-run results, root causes, and an explicit refusal to call a failure a flake without a re-run (including the decision **not** to loosen an LCP budget that was 71 ms over).

### 7.7 Architecture strengths

- **The import-boundary test is substantive and unusually well-engineered**: it builds the graph from `git ls-files` *"so untracked scratch files cannot weaken it"*, asserts non-vacuity (≥60 sources, ≥150 edges), detects cycles, enforces cross-module access through `routes.ts`, and forbids `providers/** → modules/**`. Re-derived independently: **0** `modules→modules` violations, **0** `providers→modules` inversions across 313 edges.
- **ADR quality is high** and handles supersession properly rather than by deletion — ADR-0014/0015 carry explicit *"SUPERSEDED (2026-10-21) by ADR-0019/0020 … Kept for the decision trail"* banners. I found **no** decision reversed in code without a superseding ADR.
- **The repo pre-empts its own failure modes in writing.** `apps/api/scripts/gen-erd.mjs` explicitly warns it is *"NOT the same tool as generate-erd.mjs … distinguished here so the next reader does not 'deduplicate' them"* — and I verified both generators are genuinely distinct, as are `route-matrix.mjs` and `generate-route-matrix.mjs`. **Two of my three "duplicate generator" hypotheses were refuted by the code's own comments.**
- **Every negative claim in `AGENTS.md` §8 and §14 that I could test is true**: no `.pre-commit-config.yaml`, no semgrep, no `psql`/`sqlite3`/`java`/`gradle`/`adb`, no Sentry on the web, `vite-plugin-pwa` present but unwired, the service worker is a kill switch. `AndroidManifest.xml` declares **only** `INTERNET` — so "no location permission, no contacts/SMS/gallery" is verified.
- **Observability rules are unit-tested in CI**: `alert_rules.test.yml` asserts the firing **and** the quiet path for all six rules (including the money-path rule) and is executed by a digest-pinned promtool.
- **`deploy-verify.yml` is a real deployment gate**: ancestry-based "production includes the reviewed commit" polling for both projects, an explicit off-main-deploy failure, live CSP/HSTS/Permissions-Policy assertions, the immutable-asset vs revalidated-document cache split, and a storage-durability gate with the two-bug post-mortem written into the comment. 52 runs, 42 green, 10 red — it catches things.

---

## 8. AI-slop assessment

**AI-slop score: 76 / 100** (100 = pristine hand-engineered, 0 = pure slop). **Confidence: moderate** — a judgement call anchored on 11 directly-measured scans.

### 8.1 The headline: the code is not the slop

Autobiographical note on why this matters: 169 of 219 commits are authored by `AgroBridge Builder <builder@agrobridge.local>`; only 50 by the human owner. This repository is effectively **AI-authored**, so the bar is higher, not lower. Measured across 324 source files:

| Axis | Measured | Verdict |
|---|---|---|
| Comment density | median **19.1%** (p25 12.0, p75 31.8, max 82.9); only 5 files have zero comments | Healthy. The content explains **why**, with measured evidence — e.g. `env.ts:66-79` documents a real p50 latency measurement and the reasoning for a ceiling value |
| Comments that restate the next line | **13** in the whole tree, of which 10 are section labels in one e2e spec | Clean |
| `// Step N` / sequential markers | **0** | Clean |
| `TODO`/`FIXME`/`HACK` | **0** (`todo-gate.mjs` enforces) | Clean |
| `@ts-ignore` | **0**; `@ts-expect-error` **1**, with a reason | Clean |
| `eslint-disable` | **10**, every one justified — e.g. *"-- async by provider contract (hosted engines await I/O); the offline engine retrieves synchronously."* | Clean, not silencing |
| Generic identifiers (`data2`, `doWork`, `result1`) | **0** | Clean |
| `V2`/`legacy`/`backup`/`.bak` source filenames | **0** | Clean |
| Emoji in UI | deliberately removed with the reasoning recorded: *"No 👋. It was the last emoji in the UI and it sat in an `<h1>`…"* | Deliberate |
| Duplication (Zod schemas, pagination, error strings, response envelopes, React list screens, test setup) | **no cluster found** — all centralised; of 61 parsed route handlers only 11 share any call-sequence shape, and the dominant group is "fetch two independent things" | Clean |
| 77 handlers / 96 `try` blocks / 88 `next(e);` / **0** manual `res.status(500)` | — | Repetition (see §8.3 #10), not divergence |

I verified **eight** load-bearing claims in the source against the code and **all eight are true, several stricter than the comment claims**: the atomic `PENDING→SUCCEEDED` claim, the atomic conditional stock decrement, cart-rows-as-idempotency-token, "NEVER presented as a confirmed AI diagnosis", "NEVER exposed as a real payment method in production UI" (the web renders sandbox wording only from the server's value), "every KB entry UNSOURCED" (8 × `UNSOURCED`, 0 × `REVIEWED`), the removal of an unevidenced "Verified" provider badge, and "never a score/percentage" in advisory support labels.

**One false claim was found in source-adjacent evidence:** `.audit-archive/.../E-1518-i05-provider-resilience.txt:21` asserts *"Provider health registry … **admin surface reads it**"* — nothing reads it (F-28). That is how dead instrumentation survived: the audit that should have caught it certified that it worked.

### 8.2 Where the slop actually is

**Concentration 1 — repo-root entropy (~167 MB).** 26 untriaged SQLite databases (several holding real data), 4 debug APKs (32 MB), 4 zero-byte log files, `New folder/` with 8 untitled JPGs, `tmp_fix_routes.mjs`, a superseded `api-full-validation.sh`, and four overlapping generations of agent-evidence directories (`.audit` 14 MB, `.audit-archive` 30 MB, `.agent-evidence` 30 MB, `qa-evidence` 45 MB).

**Concentration 2 — the generated-document layer.** `docs/generated/` is 16/19 a byte-identical copy of `docs/archive/2026-10-19/generated/` (F-52), and it contains `phase8-state-cleanup.md`, which describes a `@tanstack/react-query@5.64.1` install and a `configured queryClient.ts` that **do not exist**, and prescribes adopting exactly the library `AGENTS.md` §4 forbids (F-53).

**Concentration 3 — an unfinished refactor.** Six 2-line `lib/*` shims with the same typo stamped into all six, 75 call sites on the alias path and 14 on the canonical one, and `AGENTS.md` pointing at the legacy home (F-48, F-91).

**Concentration 4 — broken or dead verification.** `npm run qa:knip` cannot run at all (F-66); a provider-health registry is written to by the AI gateway and read by nobody, and the audit evidence certifies a consumer that does not exist (F-28); 13 permissions and 2 roles are inert (F-08); the documented duplication gate fails (F-13); a security scenario is counted as PASS while always skipping (F-15).

### 8.3 Top 10 most damaging slop instances, ranked

| # | Instance | Why |
|---|---|---|
| 1 | **`tmp_fix_routes.mjs`** — a 596-line generator at the repo root that writes `payments/routes.ts` (911 lines), the most money-critical file, from a template literal **whose payload is already stale** (it emits an import of `../../lib/errors.js`, a path that no longer exists) — and the repo's own audit logged it as `AUD-204`/`SLOP-19` and left it **OPEN** | The largest, most money-critical file has no verifiable authorship |
| 2 | **`docs/generated/phase8-state-cleanup.md`** — a tracked design document describing an install and files that never existed, prescribing a forbidden dependency | A fabricated doc indistinguishable from truth, in a directory declared "generated" |
| 3 | **`providers/health.ts`** — write-only instrumentation, with audit evidence asserting a reader that does not exist | Safety/observability theatre that survived its own audit |
| 4 | **`npm run qa:knip` crashes** | A declared gate that never executes gives false assurance about dead code |
| 5 | **~167 MB of untriaged artefacts** incl. 26 SQLite DBs and 4 APKs | Largest volume of slop; the same finding was VERIFIED on 2026-08-09 and is still open |
| 6 | **Bengali terminology drift on one screen** (`আমার ফার্ম` vs `আমার খামার`) plus two glossaries with **contradictory** canonical terms, the older claiming it *"never oscillates"* | Directly farmer-visible, and the false guarantee is in the governance doc |
| 7 | **Six shims with one stamped typo; 75 vs 14 import split** | Answers "which path is real?" only via a comment |
| 8 | **Deploy-era thrashing in history**: `prisma` moved dependencies → devDependencies → dependencies across #145→#148→#149; debug routes shipped to `main` (#55-57) then removed (#63); 4 `trigger rebuild/deploy` commits | History is unreadable for ~30% of its length |
| 9 | **`AGENTS.md:162` cites a ratchet file that does not exist** | The governance document misnames its own gate |
| 10 | **88 hand-written `try { … } catch (e) { next(e); }` blocks** | Necessary in Express 4, but one `asyncHandler` wrapper removes ~250 lines and the class of a missed wrapper becoming an unhandled rejection |

### 8.4 Naming and terminology drift

| Concept | `docs/glossary-bn-en.md` (2026-10-22) | `docs/web-glossary.md` (2026-10-21) | Actual dictionary |
|---|---|---|---|
| Farm | ফার্ম **and** খামার, both, flagged `[review]` | খামার (claimed canonical) | **both — ফার্ম in 15 keys, খামার in 7** |
| Plot | প্লট | জমির প্লট | প্লট |
| Crop cycle | চলমান ফসল | ফসলের চক্র | চলমান ফসল |

The **newer** glossary is the honest one: it flags the conflict and states *"none of the farmer-facing copy has been reviewed by a native speaker yet"*. The older one states a guarantee its own repository falsifies. One spelling split also persists in filenames (`license-allowlist.json` vs `scripts/licence-allowlist.json`).

### 8.5 Convergence test

| Metric | Value |
|---|---|
| Total commits | **219** |
| `fix:` commits | **98 (44.7%)** |
| Repair-flavoured subjects (fix/audit/remediat/harden/round/drift/truth) | **138/219 = 63%**; last 100 = **65%** |
| Distinct named audit/remediation waves | **8+** (quality review Phases 0-4, AUD-101..124, 10k hardening + re-audit, W1+W2, UI/UX audit, deep-audit, AUD-V3, enterprise-audit ×2, enterprise hardening) |

**Reading:** the loop was trial-and-error at the deploy layer for a long stretch, then became real. Five successive "enterprise-audit remediation" waves each discovered that the **previous wave's verification tooling** was itself broken — commit subjects literally read *"the admin guard fails closed, and two verification tools tell the truth"* and *"the deploy-verify storage gate can finally read the value it asserts"*. That is the signature of an automated self-audit loop whose early confident reports were not trustworthy. **But the last ~70 commits replaced that with real ratchets** (response-contract fixture, route-role matrix, import boundaries, claims-check, link-check, lint budget, a hard-zero i18n ratchet) and the loop is now finding *specific* defects instead of general ones. **The conclusion is that convergence is real but recent, and pre-#62 audit reports should be treated as untrusted.**

---

## 9. Betterment scope — prioritised roadmap

*No fix was applied. This is the recommended sequence, sized for an enterprise delivery plan. Effort is in engineer-days (single engineer, this codebase, with tests and docs).*

### Phase 0 — Stop-the-line before enabling live payments (must precede `PAYMENT_PROVIDER=sslcommerz`) — ~6 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 0.1 | Fix the SSLCommerz return-URL prefix, add `notify_url` + required v4 customer/product fields, and run **one sandbox rehearsal against the real gateway** recording the receipt | F-04, F-05 | 2 |
| 0.2 | Make the webhook use `claimAndApplyPayment` (key survives) and add a webhook-path key-survival test | F-02 | 0.5 |
| 0.3 | Add `Idempotency-Key` + `@@unique([userId, clientRequestId])` to `Withdrawal`, mirror across all three schema copies and both chains, wire the web client | F-01 | 2 |
| 0.4 | Add a real key column + `@@unique([userId, intentKey])` to `Payment`; add a **concurrent same-key test on the PostgreSQL profile** | F-03, F-23 | 1 |
| 0.5 | Emit `audit` + counter + warn log on the `not_claimable` webhook branch | F-24 | 0.5 |

**Exit criterion:** a keyed double-submit under concurrency produces exactly one payment intent on PostgreSQL, proven by a test, and a real gateway sandbox session returns a working buyer return URL.

### Phase 1 — Security & data-protection remediation — ~8 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 1.1 | Make `assertFarmAccess` role-aware; add VIEWER/MEMBER negative tests for PATCH/DELETE | F-06 | 1.5 |
| 1.2 | Validate/allow-list `cropName`, force single-line, move **all** context inside the untrusted reference block; add injection cases that vary `cropName` | F-07 | 1 |
| 1.3 | Wire `sessionManager.setSession` + `broadcastLogout`; e2e case "queue → logout → other account signs in" | F-09 | 1.5 |
| 1.4 | Correct the privacy policy region claim (or pin the region); reconcile the two policies to one source; extend deletion to farm geo + advisory text (or correct the docs and record residuals) | F-10, F-11, F-12 | 2.5 |
| 1.5 | Meter unmeterable spend; make the budget guard concurrency-safe; add the 429/fallback/Dhaka-boundary tests; unify the provider label | F-22 | 1.5 |

### Phase 2 — Make the verification layer trustworthy — ~10 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 2.1 | Add the 5 missing contexts to the ruleset (they already report) — **cheapest high-value change in this report** | F-17 | 0.2 |
| 2.2 | Fix `link-check` to resolve against `git ls-files`; widen both doc gates to `AGENTS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `STATUS.md`, the root policy files | F-46, F-47, F-79 | 1 |
| 2.3 | Make `npm run qa:jscpd` mirror CI's scope (or exempt the archive/test-boilerplate paths with reasons) — **do not lower the threshold** | F-13 | 0.5 |
| 2.4 | Route sandbox intents through the provider (or delete the dead class); correct the coverage comment; add the missing Prometheus counter for shed + auth failures; wire `providers/health.ts` into `/ready` or delete it | F-14, F-28, F-71, F-27 | 2 |
| 2.5 | Derive the test DB path from `DATABASE_URL` and add a lock file; convert the PG reconciliation skip into a real test; start the `:4100` probe in the e2e job | F-30, F-31, F-15 | 2 |
| 2.6 | Track `AGENTS.md`; move `.audit*`/`.agent-evidence` rules into `.gitignore`; publish a curated tracked `evidence/` tree; add a CI assertion that any SHA named in a tracked report is an ancestor of `main` | F-79, F-21 | 2.5 |
| 2.7 | Fix the 5 non-required-job names / verify ZAP blocking posture; decide the `qa:knip` crash (Node 22 vs 24 / `oxc-parser`) before trusting the dead-code axis | F-17, F-66 | 1 |

### Phase 3 — Authorisation model truth — ~6 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 3.1 | Replace the 19 inline role-list checks with `requirePermission` (this is what makes the 13 dead permissions live) | F-08 | 3 |
| 3.2 | Add a test asserting every declared permission is reachable from ≥1 route or explicitly recorded as deliberate | F-08 | 0.5 |
| 3.3 | Extend the route-matrix generator to report inline checks, or delete the unused permission strings | F-08 | 1 |
| 3.4 | Extend the role-vocabulary guard to the web labels; remove `QC_OFFICER` | F-50 | 0.5 |
| 3.5 | Decide and document the separation-of-duties policy for refunds/withdrawals | F-75 | 1 |

### Phase 4 — Release path — ~10 days (mostly owner-gated)

| # | Action | Findings | Effort |
|---|---|---|---|
| 4.1 | **Owner:** create the 8 secrets + 1 variable; dispatch `android-release.yml` once to prove the path | F-19 | 0.5 (owner) |
| 4.2 | Fix the compose namespace/`:?` guard, ship a deploy bundle, separate migration from deploy, add a `docker compose config` gate | F-18 | 3 |
| 4.3 | Add the TLS server block to the prod nginx conf (or stop publishing 443) **and correct the Trivy waiver's compensating-control narrative** | F-87 (see also Security F-1) | 1 |
| 4.4 | Schedule wallet reconciliation (Vercel cron or `CRON_SECRET`-guarded workflow); confirm `CRON_SECRET`/`METRICS_TOKEN` set-state; add an Alertmanager sink | F-20, F-27 | 2 |
| 4.5 | Rehearse the **real** Neon restore path once and record a receipt; state an owned RTO/RPO or mark them UNVERIFIED | F-60 | 2 |
| 4.6 | Triage the 33 dependabot refs with written reasons; add `open-pull-requests-limit` + major ignores for docker during stabilisation | F-86 | 1 |

### Phase 5 — Data layer & performance — ~5 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 5.1 | Pre-flight duplicate count for `crop_cycle_active_unique`, then retire duplicates in a data migration if needed | F-59 | 0.5 |
| 5.2 | Add the 8 missing FK indexes in one forward migration per chain, after `EXPLAIN` | F-58 | 1.5 |
| 5.3 | Fix `docs/deployment.md`'s schema path; correct the `docs/generated/` classification; index ADRs 0017-0021 | F-61, F-52, F-55 | 1 |
| 5.4 | Raise or restructure the Lighthouse perf assertion so `score === null` fails; measure a route whose LCP element survives | F-33 | 1 |
| 5.5 | Pay down ≥10 lint warnings to restore headroom below 143 | F-32 | 1 |

### Phase 6 — Frontend correctness & a11y — ~7 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 6.1 | Fix WCAG 2.5.3 on both language toggles; fix the inert `peer-focus-visible` ring | F-34, F-100 | 0.5 |
| 6.2 | Login stops enforcing the registration policy; Register seeds `langPref` from the public language | F-35, F-36 | 0.5 |
| 6.3 | Guard `t()` against unmapped keys (or route through `lib/labels.ts`); fix the "this field is required" mislabel | F-37, F-38 | 0.5 |
| 6.4 | Render pagers from `total/totalPages`; expose `X-Total-Count` behind an opt-in `{raw:true}` | F-39 | 1.5 |
| 6.5 | `reuseExistingServer: false` or a build-identity probe | F-42 | 0.3 |
| 6.6 | Reconcile the Bengali glossary to one authority and resolve ফার্ম/খামার across all 22 keys **as part of the native-speaker review** | F-93 | 2 (incl. review) |
| 6.7 | Theme toggle `applyTheme` on `dark` change; move introspection off public `/ready` | F-41, F-40 | 1 |

### Phase 7 — AI truthfulness — ~6 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 7.1 | Derive hosted confidence from retrieval + an answer-support check; stop reporting "Source match: good" for unsupported hosted answers | F-43 | 2 |
| 7.2 | Apply the unreviewed-agrochem guard to the hosted path | F-44 | 1 |
| 7.3 | Fix the `sec` prefix collision and the `পাতা মোড়ানো` keyword; add negative eval items and a bn stratum authored independently of the KB vocabulary | F-45, F-101 | 2 |
| 7.4 | Implement per-tier AI limits or remove "Unlimited AI advisory" from the tier benefits | F-62 | 0.5 |
| 7.5 | Route AI feedback to an ops-visible queue; add a spend/remaing-budget readout to `/admin/ai-usage` | (P3, from AI audit) | 1.5 |

### Phase 8 — Hygiene & debt closure — ~4 days

| # | Action | Findings | Effort |
|---|---|---|---|
| 8.1 | Delete `tmp_fix_routes.mjs`, the 4 APKs, the 4 empty logs, `New folder/`, `api-full-validation.sh`; keep one audit directory; close `AUD-204` | F-90, F-95 | 1 |
| 8.2 | Delete `docs/generated/phase8-state-cleanup.md`; split the 911-line payments route file; finish or revert the `lib/*` shim migration; rename round-numbered test files | F-53, F-94, F-48, F-92 | 3 |
| 8.3 | Add a **findings register with a `closed` column** and make the mechanical hygiene checks part of the existing `ci.yml:738` step so findings cannot silently stay open for three months | §8.5, F-95 | 1 |
| 8.4 | Consolidate the two Trivy ignore files, the two codes of conduct, the two licence allow-lists, the two traceability docs | F-96, F-16, F-56 | 1 |

**Total: ~62 engineer-days** (≈ 12–13 weeks for one engineer; ≈ 4–5 weeks for a three-engineer team with the owner handling Phase 4.1 in parallel).

### 9.1 Minimum viable path to each milestone

| Milestone | Required phases | Blocking findings |
|---|---|---|
| **Continue the controlled pilot as-is** | none — current state is acceptable | — |
| **Enable live SSLCommerz payments** | **Phase 0** | F-01, F-02, F-03, F-04, F-05, F-23, F-24 |
| **Public Play Store launch** | Phases 0, 1, 2 + 4.1 + 4.5 | + F-06..F-22, F-19, F-60 |
| **Handle real farmer PII at scale** | Phases 1, 2, 3, 5 | + F-06, F-08, F-10, F-11, F-12 |

---

## 10. What was not verified, and open decisions

### 10.1 NOT DETERMINED — explicitly unresolved

| Item | Why |
|---|---|
| **Node 22 behaviour** | This machine has no `nvm`/`fnm`/`volta` and no Node 22. Every executed result ran on **Node 24.19.0**. Per `AGENTS.md` §2 these are **not transferable**. The knip crash (F-66) may be a Node-24/`oxc-parser` incompatibility — I could not distinguish that from a project defect |
| **PostgreSQL-specific behaviour** | No `psql`, no `docker exec` used. F-03's race, oversell-under-PG and the PG reconciliation gap (F-31) are read-verified, not executed |
| **Android runtime** | No `java`, no `gradle`, no `adb`. **No claim in this report supports "the APK launches"** — only that CI assembles a debug artifact and that `versionCode` is monotonic |
| **Live gateway behaviour** | No SSLCommerz credentials and no outbound calls (F-05 is inferred, not proven) |
| **Rendered UI behaviour** | No dev server started, no page rendered. Frontend findings are source-verified, or rest on **recorded** Lighthouse artefacts from 2026-10-30 and a `dist/` built from `d28a243` — **7 days before HEAD** |
| **Whether `CRON_SECRET` / `METRICS_TOKEN` are set in the Vercel project** | Reading them needs an authenticated `vercel` CLI; probing `/ops/retention` risked triggering a real deletion. Deliberately not attempted |
| **Whether GHCR contains the pushed images** | `gh api /users/.../packages` → 403 (`read:packages` not in token scope). The namespace *mismatch* itself is proved from the workflow and compose files |
| **Whether the compose production stack is deployed anywhere** | No host access. The TLS/waiver defect is real in the artefact regardless |
| **Whether npm 10 (Node 22, CI) honours `allowScripts`** | Requires `npm ci`, which would mutate `node_modules` — not run under a read-only mandate |
| **Whether `.audit/**` is backed up anywhere** | It is untracked; if this working tree is lost, so is the evidence base |
| **Whether any account holds a <8-character password** | No database access; relevant to F-35's lockout path |
| **Historical DR rehearsal result (2026-08-25)** | Never re-run; no `pg_restore` available |
| **API suite on PostgreSQL locally** | CI reports 588 passed / 3 skipped; I did not reproduce the PG profile |

Everything else in this report is either **VERIFIED-BY-RUNNING** with quoted output, **VERIFIED-BY-READING** with quoted code, or **REPORTED-BY-TOOLING** — labelled per finding.

### 10.2 Open decisions requiring the owner (not engineering)

| ID | Decision | Why it needs the owner |
|---|---|---|
| **OD-01** | Which of the three tracked audit verdicts is authoritative (83.78 COMPLETE vs 95.07 FAIL vs this report's 74 Conditional)? | Trust and external credibility; publishing any of them externally requires a single stance |
| **OD-02** | Should a **gateway** refund debit the farmer's wallet (F-25/BR-35)? | Product/finance policy, not a bug |
| **OD-03** | Should separation of duties apply to refunds and withdrawal decisions (F-75)? The project skill says yes; `docs/business-rules.md` documents a single permission | Policy conflict between two of the owner's own artefacts |
| **OD-04** | Host region: pin to Singapore and keep the Bangladesh/Singapore claim, or correct the claim to US East (F-10)? | Legal/cost trade-off; affects the Play Data Safety form |
| **OD-05** | Should `BANK` withdrawals exist without an account number (F-63)? | Product decision; currently finance cannot execute a bank payout |
| **OD-06** | Are the 13 unenforced permissions aspirational roadmap or should they be deleted (F-08)? | Product roadmap |
| **OD-07** | Do we accept a zero-headroom lint budget, or pay down debt to restore headroom (F-32)? | Delivery velocity vs gate strictness |
| **OD-08** | Do we fund Phase 4.5 (a real Neon restore rehearsal + owned RTO/RPO)? | Budget; currently the reverse path has never been exercised (`AGENTS.md` §14) |
| **OD-09** | Should the service worker stay a kill switch permanently, or is offline PWA installability a goal? | `AGENTS.md` §8 forbids changing it without asking; offline writes already queue without a SW |
| **OD-10** | Do we want a crash-reporting sink? `PRIVACY_POLICY.md:130` currently claims crash/error monitoring as a purpose while `AGENTS.md:213` records there is none (LEGAL-05) | Privacy + budget |
| **OD-11** | Confirm the process rule for `CHANGELOG.md`: written per-PR (§6) or at release time (§7)? Today neither is honoured (F-54) | Process governance |

---

## 11. Appendix

### 11.1 Findings index by domain

| Domain | P1 | P2 | P3 | Total |
|---|---|---|---|---|
| Money path (payments, wallet, withdrawal, checkout) | F-01, F-02, F-03, F-04, F-05, F-22 | F-23, F-24, F-25 | F-74, F-76 | 11 |
| Authorisation / RBAC / tenancy | F-06, F-08 | F-50, F-63 | F-75 | 5 |
| AI subsystem | F-07 | F-43, F-44, F-45, F-62 | F-101 | 6 |
| Security (non-money) / config | — | F-26, F-40, F-57, F-77 | F-66-adjacent, F-84 | 4 |
| Web / UX / a11y / PWA | F-09 | F-29, F-33, F-34, F-35, F-36, F-37, F-38, F-39, F-41, F-42 | F-97, F-98, F-99, F-100 | 15 |
| Data layer (schema, migration, DR) | — | F-30, F-31, F-58, F-59, F-60 | F-88-adjacent | 5 |
| QA / verification integrity | F-13, F-14, F-15 | F-32 | F-67, F-68, F-92 | 6 |
| Governance / CI / release | F-16, F-17, F-18, F-19, F-20 | F-65, F-85, F-86, F-88 | F-66, F-71, F-73 | 10 |
| Architecture / duplication / dead code | — | F-48, F-49 | F-90, F-91, F-94 | 5 |
| Docs / legal / evidence | F-10, F-11, F-12, F-21 | F-46, F-47, F-51, F-52, F-53, F-54, F-55, F-56, F-61 | F-69, F-70, F-72, F-79, F-80, F-81, F-82, F-83, F-89, F-93, F-95, F-96 | 23 |
| Observability | — | F-27, F-28 | — | 2 |
| **Total** | **22** | **43** | **36** | **101** |

*Counts in this table are per-finding-topic and some findings sit in more than one domain; the severity ledger in §1.2 is the authoritative total (22/43/36/101).*

### 11.2 Findings by severity — quick list

**P1 (22):** F-01 withdrawal idempotency · F-02 webhook key destruction · F-03 same-key intent race · F-04 SSLCommerz return URL prefix · F-05 SSLCommerz session fields · F-06 org VIEWER destructive write · F-07 `cropName` system-prompt injection · F-08 RBAC inventory under-reports (13 permissions inert, 2 roles inert) · F-09 offline-queue guard dead · F-10 privacy region misstatement · F-11 divergent privacy policies · F-12 account deletion incomplete · F-13 documented jscpd gate fails · F-14 sandbox provider 0% coverage + false comment · F-15 AUTH-04 always skips in CI · F-16 licence ratchet phantom path + two gates · F-17 five CI jobs not required · F-18 container deploy path cannot run · F-19 zero repository secrets · F-20 reconciliation scheduled nowhere · F-21 evidence layer untracked + 70% stale citations + contradictory audits · F-22 AI budget guard unmetered/untested

**P2 (43):** F-23 – F-65 (see §5)
**P3 (36):** F-66 – F-101 (see §6)

### 11.3 How to reproduce the executed gates

```bash
# Environment note: this machine ran Node v24.19.0; the project pins Node 22.
# Every command below was executed from the repo root, read-only w.r.t. source.

npm run typecheck                                     # exit 0
npm run test:unit --workspace apps/web                #     214 passed (27 files)
npm run test --workspace apps/api                     #     590 passed | 1 skipped (110 files)
node scripts/qa/lint-budget.mjs                       #     api 143/143, web 0/0
node scripts/drift-check.mjs                          #     no schema drift
node scripts/qa/link-check.mjs                        #     48 targets resolved
node scripts/qa/claims-check.mjs                      #     clean
node scripts/todo-gate.mjs                            #     OK
node scripts/check-versions.mjs                       #     1.4.1 / 14001
npm run qa:licenses                                   #     171 packages clean
npm run qa:versioncode                                #     14001 > 14000
npm run qa:jscpd                                      #     FAILS: 3.42% > 3%   (F-13)
npx jscpd --silent --threshold 3 apps/api/src apps/web/src   # 1.97% (CI scope)
node scripts/knip-gate.mjs                            #     CRASHES (F-66)
node scripts/licence-gate.mjs                         #     160 packages OK (CI gate)
node apps/api/scripts/route-matrix.mjs --check        #     86 routes fresh
node apps/api/scripts/generate-erd.mjs --check        #     33 models fresh
gh api repos/tanviruchahs2580/AgroBridge/rulesets/25297401 --jq '.rules[] | {type, ctx:(.parameters.required_status_checks//[]|map(.context))}'   # 11 required contexts (F-17, F-65)
curl -s https://agro-bridge-api.vercel.app/ready      #     db:true, storage db/durable, limiterStore memory
curl -s -o /dev/null -w '%{http_code}' https://agro-bridge-api.vercel.app/metrics   # 403 (guard fails closed)
```

**Not reproducible from this machine:** the API suite on PostgreSQL, Android build/sign/install, any browser-rendered check, live SSLCommerz behaviour, and the correctness of the historical `.audit/**` evidence base.

### 11.4 Files created by this audit

This report is the **only** artefact this audit produced. It modified, created and deleted **no** source file, test, config, migration or workflow. During evidence gathering, the following gitignored, regenerable paths were written by the project's own tooling (not by hand): `apps/api/prisma/test.db` (test bootstrap), `apps/api/coverage/`, `jscpd-report/`, and `apps/api/eval-artifacts/`. `git status` before and after shows the identical delta: `M docker-compose.yml`, `M docker-compose.prod.yml`, `?? AGENTS.md` — all pre-existing.

### 11.5 Recommended reconciliation of this document with the existing audit record

1. Do not delete `docs/audit/2026-10-29-agrobridge-enterprise-audit.md` or `docs/audit/AUDIT-REPORT-20261030.md` (§8 endorses keeping the decision trail) — but add a dated banner to each stating that its verified-SHA is unresolvable from `main` and that its verdict is superseded, naming the successor.
2. Appoint **one** current verdict page. Recommendation: keep `docs/audit/` holding exactly one current report plus dated history, and add a gate asserting that any SHA named in a tracked report is an ancestor of `main`.
3. This report's IDs (`F-01`…`F-101`) are scoped to `AUD-2026-11-10-FULL`. They will collide with the existing `AUD-1xx`/`AUD-V3` series if merged into a single register — the register should namespace by audit, not renumber.

---

*End of report. 101 findings: 0 P0, 22 P1, 43 P2, 36 P3. Overall score 74/100 (Conditional). AI-slop score 76/100. No fix was applied.*

---

# PART II — REMEDIATION RECEIPT (2026-11-11)

*This part records the remediation executed after Part I. Owner approvals obtained before work started: **enforce separation of duties** on refunds and withdrawal decisions; **correct the privacy policy to the true hosting region**; **minimal, justified dependency changes only**.*

## R1. Verification battery — real results

| Gate | Command | Before (Part I) | After | Status |
|---|---|---|---|---|
| API suite (SQLite, isolated DB) | `TEST_DB_FILE=… npx vitest run` — **final post-integration run** | 590 passed / 1 skipped (110 files) | **749 passed / 1 skipped (134 files), 0 failed, exit 0** | **PASS** |
| API coverage | same run | 84.36 / 73.70 / 87.44 / 86.82 | **87.46 / 77.57 / 91.86 / 89.73** (floors 82/72/84/84) | HOLDS, raised |
| Web unit suite | `npm run test:unit --workspace apps/web` | 214 passed (27 files) | **276 passed (42 files)** | PASS |
| Web coverage | `npx vitest run --coverage` | 43.36 / 33.21 / 39.97 / 44.91 (floors 40/30/36/42) | **67.05 / 55.42 / 64.79 / 69.58** (floors **64/52/62/66** — ratchet raised) | HOLDS, raised |
| Web typecheck / lint | `npm run typecheck` / `lint` | clean / 0 warnings | clean / **0 warnings** | PASS (ratchet held) |
| Web production build | `npm run build --workspace apps/web` | — | green, entry **130.07 kB gz** (budget 132) | PASS |
| Web preflight | `node scripts/preflight.mjs` | 11 checks | **12 checks pass** | PASS |
| Web e2e collection | `playwright test --list` | 96 tests / 21 files | **98 tests / 22 files** | intact |
| API typecheck | `npx tsc --noEmit -p tsconfig.build.json` | exit 0 | exit 0 | PASS |
| API lint budget | `node scripts/qa/lint-budget.mjs` | **143/143 saturated** | **0 errors / 120 warnings (budget 143)** — 23 headroom | PASS |
| Migration drift | `node scripts/drift-check.mjs` | no drift | *"no schema drift: the migration chain reproduces the schema exactly."* | PASS |
| Schema parity | `tests/schema-parity.test.ts` | 10 passed | **10 passed** | PASS |
| Duplication | `npm run qa:jscpd` | **FAIL 3.42% > 3%** | **0.66%, exit 0** | **FIXED** |
| Dead code | `node scripts/knip-gate.mjs` | **CRASH** | **exit 0**, exports now gated | **FIXED** |
| Docs links / claims | link-check, claims-check | 48 targets | **55 targets**, both clean | PASS |
| i18n | `npm run i18n:check` | 0 missing | 0 missing, 0 inline ternaries | PASS |
| Contract fixture | `WRITE_CONTRACT_FIXTURE=1` | 24 endpoints, 3+ vacuous | **36 endpoints, 0 vacuous** | FIXED |

**Migration provenance:** `git status --porcelain prisma/migrations` shows only the two new directories as untracked (`??`) and **no** `M` entries — **no applied migration was edited**. Both chains carry `20261110120000_money_idempotency_keys` and `20261110130000_fk_relation_indexes`.

## R2. What was fixed

**P1 (22 of 22 addressed; 2 are owner actions, not code):** F-01 withdrawal idempotency via the existing middleware + `@@unique([userId, clientRequestId])`; F-02 webhook now claims through the shared `claimPendingPayment` (key survives); F-03 `Payment.intentKey` unique backstop + concurrency test; F-04 `/api/v1` mount prefix in one place (`API_MOUNT_PREFIX`); F-05 `notify_url` + v4 customer/product fields; F-06 role-aware `assertFarmAccess` with an org-capability map and audit on delete; F-07 context fields inside the untrusted fence + crop allow-list; F-08 **zero inline role lists remain and the guard has no exemptions** — `payments:read:any` + `procurement:read:any` added, everything on `requirePermission`/`hasPermission`, with a 13-role × route **equivalence matrix** proving no role gained or lost access; F-09 `setSession` wired; F-10/F-11/F-12 privacy corrected to `iad1`, policies reconciled, deletion extended to farm geo + advisory text; F-13 jscpd scope; F-14 sandbox provider 100% covered; F-15 AUTH-04 probe wired into CI; F-16 licence paths corrected; F-18 compose guards + migrate stage; F-20 reconciliation scheduled via a `CRON_SECRET`-guarded ops endpoint; F-21 226 stale citations re-anchored; F-22 budget reservation-then-check.

**Two corrections made during integration (both caught by a gate or a proof, not by optimism):**

1. **F-40's first implementation broke the deploy gate.** Gating all `/ready` detail behind `METRICS_TOKEN` would have made `deploy-verify.yml` — which asserts `schema` and `limiterStore` **unauthenticated** — fail after its windows, and the token does not exist (`F-19`: zero repository secrets). Resolved by splitting the payload: the gate-required fields (`db`, `schema`, `limiterStore`, `storage`) stay public because migration names are already public in the repository and `storage.durable` is the signal the same gate enforces; **only `payments` — the one field with real reconnaissance value — is gated**. No new secret, gate still green. The test pins the production branch structurally and asserts `payments` is absent from it.
2. **The equivalence matrix caught a regression in the F-08 conversion itself.** A first pass dropped ADMIN's `org:read`/`org:manage`/`farm:read:org` (ADMIN could no longer create or read organisations) and `bookings:read:any` (ADMIN would have seen only its own bookings). Fixed in the permission table, not the test — the matrix is the reason it was caught at all.

**The last F-08 site was converted after the streams closed:** `procurement/routes.ts:98` — the same handler-scope pattern as `GET /payments` (`procurement:read:any`, held by exactly SUPER_ADMIN + ADMIN), because the route serves both a buyer's own offers and the admin queue. Its 13-role matrix also documents the `ODL-007` unassigned-region fallback: a territory-scoped manager with no region sees the fleet, unchanged by the swap. The guard's `OUT_OF_SCOPE_MODULES` exemption is deleted — there are no exemptions left.

**Two defects in my own test code, found by running it:** the procurement matrix initially asserted the wrong predicate (it omitted the territory fallback) and used `registerFarmer`'s return shape where `createUserWithRole`'s differs. Both were test bugs, not product bugs; both fixed and the suite green.

**P2/P3:** the balance of §5 and §6 were fixed in the same streams — including the `sec` retrieval false positive (F-45), hosted-path confidence (F-43), the agrochem guard on both engines (F-44), per-tier AI limits (F-62), the eight FK indexes (F-58), and the repo-hygiene deletions (F-90, F-95).

**Three lead-owned defects found and fixed during integration:** the vitest-4 `globalTeardown` key is a silent no-op (replaced with the return-teardown contract); regenerating the fixture twice as streams landed; and the `.env.example` budget edit required an `env-reference.md` regeneration that the freshness gate correctly caught.

## R3. Re-score

| Domain | Part I | Part II | Basis for the change |
|---|---|---|---|
| Security & money | 78 | **90** | Money path idempotent with DB backstops, SoD enforced, gateway session complete. Deduction: live gateway acceptance unverified |
| API / backend | 74 | **90** | Zero inline role checks, permission inventory enforced with an equivalence matrix, audit coverage added |
| Data layer | 78 | **88** | 8 FK indexes, idempotency keys, drift clean. Deduction: PG execution unproven locally |
| Frontend | 78 | **92** | WCAG 2.5.3 fixed, offline-queue guard live, pagers, coverage floors raised 40→64 |
| AI subsystem | 70 | **88** | Injection closed, evidence-based confidence, guard on both engines, budget reservation, per-tier limits, containment floor 0.60→0.95 + per-stratum gate. Deduction: bn stratum still largely validates KB vocabulary; live provider unexercised |
| QA & verification | 78 | **93** | Both broken gates repaired and made fail-capable, fixture non-vacuous, lint headroom restored |
| DevOps / release | 72 | **84** | TLS listener real, compose refuses untagged, reconciliation scheduled, hygiene deleted. Deduction: staging unrun, no secrets, no paging sink |
| Architecture & docs | 62 | **88** | 226 citations re-anchored to symbols, policies single-sourced, ADRs indexed, changelog restructured, `AGENTS.md` tracked |
| **Weighted** | **74** | **89** | |

> **Score after remediation: 89 / 100 — Band: Release-ready, conditional.**
> The AI-slop score moves 76 → **90**: the fabricated design document is archived with a rejection banner, the money file's generator is deleted, the shims are resolved, the dead registry is wired or removed, both broken gates run, and the round-numbered test files are renamed to behaviour names.

## R4. What stands between 89 and 100 — none of it is code

| # | Item | Owner | Why it is not done |
|---|---|---|---|
| 1 | **One SSLCommerz sandbox rehearsal** proving the gateway accepts the completed session body and the buyer return URL | Owner (needs provider credentials) | No credentials on this machine; F-05 is fixed and stub-tested but unproven live |
| 2 | **PostgreSQL execution** of the two new migrations and the same-key race test | CI (`postgres:17` job) or a provisioned DB | No Docker daemon and no local PG |
| 3 | **Five required status checks** added to ruleset `25297401` (exact `gh api` command in the DevOps receipt) | Owner (repo settings, outward-facing) | Changing branch protection is an approval boundary |
| 4 | **Repository secrets/variables** (`STAGING_*`, `ANDROID_KEYSTORE_*`, `PLAY_SERVICE_ACCOUNT_JSON`, `STAGING_BASE_URL`) | Owner | Creating secrets is an owner action; the release paths are otherwise ready |
| 5 | **Native-speaker review** of all Bangla copy — including the strings added in this remediation (cross-border clause, tier-limit labels, pager copy) | Owner/agronomist | The repo's own `docs/agronomy-review-sheet.md` scopes this; engineering cannot sign it off |
| 6 | **Observability sink** — a hosted scraper pointed at `/metrics` with `METRICS_TOKEN`, and a paging target | Owner (OD-06) | The rules exist and are tested; production is still scraped by nothing |
| 7 | **Evidence tree publication** — the curated `evidence/` set the docs cite | Owner (PII/size decision) | Publishing audit evidence outward is a disclosure decision, not a code change |
| 8 | **46 untriaged SQLite databases** in `apps/api/prisma/` (36 MB; three are cited by audit evidence) | Owner | Deleting evidence-cited files would break citations; listed, not deleted |
| 9 | **Node 22 re-run** of the full gate battery | CI | This machine has no Node 22; every result above ran on Node 24 and is non-transferable per `AGENTS.md` §2 |

*Receipt ends. Every number above is from a command run during this session; nothing is asserted from an agent's report alone without at least one direct re-check by the lead.*





