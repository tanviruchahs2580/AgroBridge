# AgroBridge — Independent Code, Repository & AI-Work Quality Review

**Date:** 2026-10-17 · **Reviewer:** independent audit pass (three parallel read-only reviews + the
reviewer's own verification of every high-severity finding) · **Baseline:** `main` @ `e665b78`
· **Scope:** the whole codebase (`apps/api`, `apps/web`, database, tests, docs), the Git history,
the GitHub configuration, the CI/CD system, and — as the primary lens — **the quality of the work
produced by the AI agent sessions that built and maintain this repository**.
**Purpose:** this document is the agreed basis for the final development phase. Every finding
carries evidence, a severity, an effort estimate and acceptance criteria.

## Verification legend

| Mark | Meaning |
|---|---|
| ✅ | Independently reproduced by the reviewer on this machine (command run / file read) |
| 🔎 | Reported by a review agent with file:line evidence; the reviewer spot-checked the same family of claims and they held; the individual line was not re-read |
| ⚠️ | Pointed at by a review but **not** reproduced — do not act on it without checking first |

---

## 1. Executive summary

**Verdict: the engineering substance is mid-senior and often better than a typical funded startup;
the *governance* of that engineering is at solo-hobbyist level. The gap between the two is the
finding.**

| Dimension | Grade | One-line judgment |
|---|---|---|
| Money-path correctness | **A−** | Atomic claims, idempotency keys, race tests, compensating ledger entries; refuses to fake success. |
| API architecture & consistency | **B** | One envelope, one error factory, one route shape — but three parallel utility trees, one dead file, and policy decided per module. |
| API type safety | **C−** | `strict: false` + `noImplicitAny: false` on financial code; 133 `req.auth!`, 14 `as never`. |
| Web architecture | **B** | Clean feature boundaries, genuinely good transport layer — but server-state boilerplate is now the largest mass of code and the API contract is hand-copied 33 times. |
| Web accessibility | **B+** | Skip link, focus-on-route, aria-invalid/describedby, live regions; two verified focus-management defects in the Modal and one keyboard-invisible card. |
| Testing | **B−** | 150 API tests + 108 web unit + 24 e2e + 39-check functional sweep, behavioural assertions — but no component tests at all and the UI's riskiest behaviour is untested. |
| Documentation | **C** | README/runbooks/Play package are good; `docs/api.md`, `docs/database.md`, `UI_UX_CONTRACT.md` and the 21 root-level reports are stale, contradictory or orphaned. |
| Git history | **B−** | 95% Conventional Commits, honest revert history — but 119-file epoch commits, no tags since `v1.3.0`, generic commit identity. |
| GitHub governance | **D** | **No branch protection** (verified 404), effectively no PR flow, CODEOWNERS points at a non-existent path, 9 stale Dependabot PRs, zero issues ever filed. |
| CI/CD | **A− / C** | `ci.yml` is genuinely professional (9 jobs, dual database, Trivy/gitleaks/audit gates, SHA pins, timeouts, least privilege) — but **deployment happens outside the pipeline**, by CLI from an AI session. |
| AI-work quality | **B−** | Real fixes with real proofs and honest self-correction — undermined by a silently disabled test, an invented CI pin that only worked from cache, prompt jargon in shipped source, and evidence logs that are thrown away. |

**The two sentences that matter most:**

1. Seven public APK releases (v1.3.0–v1.3.7) shipped with **an order-history crash, a checkout that
   discarded the delivery address, a free-payments path in production and a debug-signed AAB** —
   every one of them found and fixed in a single later round by the same agent that wrote them.
   That is not a code-quality failure; it is the exact signature of **no reviewer in the loop**.
2. The repository already contains the *written intent* to fix the governance half of this
   (`docs/generated/governance-branch-protection.md`: "DOCUMENTED ONLY — no API call executed").
   The controls were specified, packaged and never switched on.

**Effort to reach an agency-signed standard:** roughly **6–9 focused engineer-days**, of which
~1 day is governance/config (immediate, no code risk) and the rest is the type-safety, module
consolidation, contract-layer and Modal-a11y work. Nothing in the backlog requires a rewrite.

---

## 2. Scope, method and measurement

Verified measurements for this review (all reproduced on the baseline commit):

| Metric | Value |
|---|---|
| API source | 5,595 lines / 60 files (`apps/api/src`) ✅ |
| API tests | 3,063 lines / 25 files — **150 tests (149 pass, 1 PG-gated skip)** ✅ |
| Web source | 9,339 lines / 40 files (`apps/web/src`, excl. tests) ✅ |
| Web tests | 2,295 lines (unit 108 cases / 5 files; e2e 24 cases / 8 specs) ✅ |
| Functional sweep | 39/39 local · 38 pass + 2 skip live ✅ |
| Test-to-source ratio | ≈ 0.41 (API 0.55, web 0.25 incl. e2e) ✅ |
| Production dependencies audit | **0 vulnerabilities** (`npm audit --omit=dev`) ✅ |
| API coverage (configured floors) | statements 75 / branches 63 / functions 73 / lines 75; measured 80.05 / 67.76 / 78.57 ✅ |
| Web coverage configuration | **none** (no thresholds, no coverage job) ✅ |
| Git | 169 commits on HEAD, 161 conventional (95.3%), 2 merges, 5 tags (max `v1.3.0`), 3 releases (latest 2026-08-25, no assets) ✅ |
| Repository root | 21 tracked `*.md` (388 KB), 9 untracked APK binaries (58 MB), stray logs/scripts ✅ |

Method: three independent read-only reviews (API quality; web quality; repository/GitHub/AI-work),
each required to cite `file:line` and forbidden from speculating; then the reviewer re-read the
files behind every P0/P1-class claim and re-ran the commands. The verification ledger is inline
below. Where an agent's claim did not reproduce, it was dropped and that is stated.

---

## 3. Code quality — API (`apps/api`)

### 3.1 Type safety (the largest single gap)

**API-1 [P1] [✅] `strict` is off and `noImplicitAny` is explicitly disabled.**
`apps/api/tsconfig.json:10` (`"strict": false`), `apps/api/tsconfig.build.json:6-7` (re-affirms
`strict: false`, adds `noImplicitAny: false`). Verified by reading both files.
*Agency standard:* no reviewer signs off `strict: false` on payment/procurement code; the compiler
is the cheapest reviewer available and it is switched off.
*Remediation:* enable `strictNullChecks` + `noImplicitAny` on `tsconfig.build.json` first, fix the
fallout per module (largest files first), then flip `strict`. 
*Acceptance:* both configs `strict: true`, `npm run typecheck` green, no new `!`/`as never` added.

**API-2 [P2] [✅] 133 `req.auth!` non-null assertions, 14 `as never` casts.** Counts reproduced by
grep. Worst cases include `apps/api/src/modules/admin/routes.ts:17` (a router-wide role gate that
asserts auth exists) and `apps/api/src/modules/payments/routes.ts:62-66,225` where
`applyPaymentSideEffects` declares its transaction parameter as `args: never`, forcing every caller
through `tx as never` (`payments/webhook.ts:64`).
*Agency standard:* auth context should be typed into the request by the middleware that gates it;
`Prisma.TransactionClient` is a real exported type and should be used.
*Acceptance:* `as never` = 0 in `src/modules/payments`; a typed `TransactionClient` import replaces
the inline `import("@prisma/client").Prisma.TransactionClient` repetition (6 sites).

### 3.2 Module structure (unfinished migration)

**API-3 [P2] [✅] Three parallel utility trees, and one dead file.**
`src/lib/*` holds thin re-export shims over `src/infrastructure/*` and `src/shared/*`. Verified:
`src/lib/errors.ts` has **zero importers anywhere** (it still compiles into `dist/`), while every
caller imports `src/shared/errors/index.ts` directly (20+ sites); `src/lib/prisma.ts` (30 importers)
is a shim over `infrastructure/database/prisma.ts` which has exactly one direct consumer
(`src/modules/membership/service.ts:1`).
*Agency standard:* one canonical home per concern; the repository must not answer "where does the
DB client live" with three paths.
*Acceptance:* one tree, dead file deleted, `membership/service.ts` importing the same path as
everyone else, `grep -c "from \"../lib/errors"` = 0 and no duplicate modules in `dist/`.

**API-4 [P2] [🔎] Cross-cutting policy is ad hoc per module.** 8 near-copy `rateLimit({...})` blocks
(count ✅) with three subtly different skip policies (dev-only vs dev+test); 7 hand-rolled role
arrays (`["ADMIN","SUPER_ADMIN"].includes(...)`) instead of the existing `PERMISSIONS` map
(`apps/api/src/middleware/rbac.ts:9-37`, which the organizations module ignores entirely); audit
coverage on money-adjacent mutations is inconsistent — `services/routes.ts` 0 audits / 6 mutations,
`organizations/routes.ts` 0 / 3 while payments has 4.
*Acceptance:* one `makeLimiter()` factory, `requirePermission` used by every gated route, an audit
policy stated in `middleware/audit.ts` and applied to services/organizations/farms mutations.

**API-5 [P3] [🔎] Inline business constants in hot paths.** Delivery pricing is hard-coded inside the
checkout transaction body (`apps/api/src/modules/marketplace/routes.ts:281`), while the good
counter-example exists one file over (`MIN_WITHDRAWAL_PAISA`, `payments/routes.ts:542`). Transaction
options `{ timeout: 15000, maxWait: 8000 }` are copy-pasted 5×.
*Acceptance:* pricing lives in a `pricing`/config module; a shared `TX_OPTS` constant.

### 3.3 Data layer

**API-6 [P1] [✅] The Prisma schema exists in three copies and the parity guard is a regex.**
`schema.prisma` (sqlite), `schema.postgresql.prisma`, `postgres/schema.prisma` (the last two differ
only by `binaryTargets`), plus two hand-maintained migration chains (8 sqlite vs 4 postgres) and a
hand-maintained probe map in `scripts/deploy-migrations.mjs`. `tests/schema-parity.test.ts` compares
two of the three by parsing the DSL with `/model\s+(\w+)\s*\{([^}]*)\}/g`, which silently voids if
any model ever gains a nested brace. The test's own comment records that index drift already reached
production once.
*Agency standard:* one source schema + codegen for the dialect, or drop the second dialect; a drift
guard that cannot silently no-op.
*Acceptance:* either a generated variant or an explicitly documented single source, and parity
enforced against all copies including indexes/constraints.

**API-7 [P2] [🔎] Missing indexes on the app's first screen.** `Product` carries no index while the
marketplace list does `where {isActive, category}` + `orderBy createdAt` + `count`; `Order` has only
`@@index([userId])` for a `userId → createdAt desc, take 100` query; `AuditLog` sorts by
`createdAt desc` unindexed while being append-only.
*Acceptance:* `Product[isActive, category]`, `Order[userId, createdAt]`, `AuditLog[createdAt]` added
in both dialects with a migration, and a note in `docs/database.md`.

### 3.4 Tests (API)

**API-8 [P2] [🔎] The suite is journey/e2e-first and genuinely behavioural.** 22 files, ~166 cases;
assertions checked are outcome-based (race conditions assert exactly-one-winner and reconcile the
wallet hold invariant; the security matrix asserts 404-not-403 to avoid an existence oracle).
Verified: the round-10 regression file exists and covers the fixed defects. Gaps with zero coverage:
the Redis rate-limit store (2/46 lines — it decides availability via a fail-open catch),
`providers/*` adapters (deliberately excluded), `server.ts` bootstrap, and the organizations
member-management branches (~46%).
*Acceptance:* a fake-Redis unit test for `createRedisStore`; organizations paths raised above the
configured floor; the exclusion list carries a one-line justification each.

---

## 4. Code quality — Web (`apps/web`)

### 4.1 Architecture & data layer

**WEB-1 [P1] [🔎] Server state is hand-managed in every feature — the boilerplate is now the largest
code mass.** 10 of 14 screens re-implement `loading/error/finally` + retry, and there are ~17 manual
refetch points after mutations (e.g. `Services.tsx:144,165`, `Market.tsx:241,284-286`,
`Wallet.tsx:162,202`). A custom `api()` transport is defensible; per-feature server-state management
at this scale is not — every forgotten refetch is a stale-UI bug waiting for a user to find it.
*Acceptance:* one typed data hook (or a small query layer) owning load/error/refetch; the 17 manual
sites reduced to declarative invalidations; no feature defines its own `load()`.

**WEB-2 [P1] [✅] The API contract is hand-copied — 33 inline interfaces, including a twin `Order`.**
`apps/web/src/lib/api.ts` exports one response type; everything else is declared inside feature
files. Verified: `Order` exists twice with different field sets (`Market.tsx:30-37` 5 fields vs
`MyOrders.tsx:25-40` 13 fields) — precisely the drift mechanism that produced this round's
order-expand crash.
*Agency standard:* one typed contract (hand-written single source or generated from the API's zod
schemas) consumed by every feature.
*Acceptance:* `lib/api-types.ts` (or generated client) exists; no feature declares an API shape
inline; a parity test fails when a response shape changes on the API side.

**WEB-3 [P2] [✅] All-or-nothing page loads from independent endpoints.** Wallet fires 5 parallel
requests and one failure blanks the page (`Wallet.tsx:84-90`); Services 3; Admin 3+1+1. `Home.tsx`
already demonstrates the correct tolerant pattern with `Promise.allSettled`.
*Acceptance:* partial-failure semantics on Wallet/Services/Admin, error text via `mapError`, and a
degraded-but-usable render.

**WEB-4 [P2] [🔎] Offline queue enqueues failed GETs.** `offlineQueue.isQueueable` matches URL
substrings only and ignores the HTTP method, so a dropped `GET /orders` is queued and counted in the
user-facing "pending changes" badge. The checkout exclusion (`NEVER_QUEUE`) is correct and recent.
*Acceptance:* method-aware allow-list (mutations only), unit tests for the matcher.

**WEB-5 [P3] [🔎] Dormant cross-tab machinery.** `broadcastLogout`/`onChange` in
`sessionManager.ts` have **zero callers** (✅ count 0) — either wire them into `session.tsx` or
delete them; a logout in one tab currently leaves another tab's React session alive until its next
401.

### 4.2 Accessibility & UX mechanics (verified defects)

**WEB-6 [P1] [✅] The Modal's focus trap re-runs on every host re-render, stealing focus per
keystroke in two dialogs.** `apps/web/src/components/ui.tsx:92` closes the a11y effect with
`}, [open, onClose]);` and the setup focuses the first focusable element. Callers that pass an inline
`onClose` and update state per keystroke reproduce the defect — `Services.tsx:413` (booking form) and
`Wallet.tsx:374` (withdraw form) — while `Market.tsx:412` (stable named handler) is unaffected, which
is why checkout escaped notice.
*Agency standard:* a focus trap is a contract; it must be stable across renders and covered by tests.
*Acceptance:* effect deps stabilised (`[open]` + ref for the callback); the first component tests in
the repo cover trap, Escape, restore-on-close, and typing-in-a-field focus retention.

**WEB-7 [P2] [✅] `inert` is applied only to `#main`.** `ui.tsx:29-30` marks `#main` inert while a
dialog is open, leaving the header, sidebar and skip link reachable programmatically behind
`aria-modal="true"`. Tab trapping hides it; assistive tech does not.
*Acceptance:* inert/aria-hidden applied to all siblings outside the dialog portal.

**WEB-8 [P2] [🔎] 9 interactive controls below the app's own 44px rule** (header row `min-h-[36px]`
at `App.tsx:175,185,194,199,203`; `AuthShell.tsx:60`; `Home.tsx:170`), while `IconButton` documents
the 44px guarantee. WCAG's floor (24px) is met, the project's own stated rule is not.
*Acceptance:* either raise to 44px on touch targets or amend the contract with the exception stated.

**WEB-9 [P3] [🔎] One keyboard-invisible disclosure** (`MyFarm.tsx:255`: a `Card` with `onClick`,
no `role`/`tabIndex`/key handler) that eslint cannot see because the handler passes through a
component prop.

### 4.3 i18n

**WEB-10 [P2] [✅/🔎] Two parallel localization systems.** `scripts/i18n-check.mjs` reports
**320 referenced / 526 declared / 0 missing** (✅ reproduced) — but the checker matches only literal
`t("key")` calls, so dynamically-keyed usage is invisible and the true unused count is materially
lower than the 206 reported. Independently, ~73 hardcoded `lang === "bn" ? … : …` ternaries remain
(concentrated in `Services.tsx` ~28 and `MyFarm.tsx` ~25), one of which sits 10 lines below a comment
claiming that file never hardcodes bilingual copy.
*Acceptance:* the checker becomes AST-based (dynamic keys resolved), the ternaries migrate to the
dictionary, and the unused-key ledger drops to ~0.

### 4.4 Testing (web)

**WEB-11 [P1] [✅] No component tests exist, and coverage is not configured.** 5 unit files (108
cases) all target `lib/`; `vitest.config.ts` is 11 lines with no coverage thresholds; nothing tests
`Modal` focus management, toasts, `errors-ui.ts` mapping, `geo.ts`, `labels.ts`, `analytics.ts`, or
`sessionManager.ts` (328 lines of token/session logic). The e2e layer is broader than most teams
have (8 specs, a11y scans, offline, splash, role guard) and is CI-enforced.
*Acceptance:* component tests for ui.tsx primitives incl. the WEB-6/WEB-7 fixes; web coverage
thresholds introduced at the measured baseline and ratcheted.

**WEB-12 [P3] [🔎] A retired visual-regression spec was renamed out of existence.**
`apps/web/e2e/visual-contract.spec.ts.bak` plus its win32-only snapshots sit in the e2e tree; the
`*.bak` ignore rule hides it from `git status`. Verified: the `.bak` file and the snapshot directory
exist. A test removed without a documented, reviewable reason is the single worst process signal in
this repository.
*Acceptance:* either restore with a documented platform-agnostic baseline, or delete the spec and its
snapshots in a commit whose message says so.

### 4.5 Build & tooling

**WEB-13 [P2] [🔎] 450 KB eager entry chunk** (React + Router + framer-motion + lucide + the entire
625-line dictionary + `ui.tsx`), with 28 routes correctly split around it. For a rural-bandwidth
PWA/APK this is the biggest perceived-performance lever.
*Acceptance:* framer-motion behind a lazy boundary; per-language dictionary chunks; a bundle-budget
check in CI (e.g. fail above 380 KB).

**WEB-14 [P3] [✅] Dead scaffolding and unused dependencies.** `src/hooks/` is empty; `zod` is a
runtime dependency with **zero imports** in `src` (count ✅); `vite-plugin-pwa` is installed while
the config explicitly disables it; `src/components/ui.stories.tsx` imports `@storybook/react`, which
is **not installed** (✅); `main.tsx:57-64` runs a `setInterval` update-announcer every 400 ms that
can never fire because no service worker is ever registered.
*Acceptance:* remove the dead files/dependencies, replace the announcer block with a comment
pointing at `public/sw.js`.

**WEB-15 [P3] [🔎] ESLint 8 is EOL** (flat-config migration overdue), and
`playwright.config.ts` sets `retries: 0` while configuring `trace: "on-first-retry"` — the trace can
never be produced, so a CI failure arrives without its diagnostic artefact.

---

## 5. Repository, Git and GitHub governance

### 5.1 Repository hygiene

**GOV-1 [P2] [✅] The root is a session-residue drawer.** 21 tracked `*.md` (388 KB) — several
contradict each other and each other's versions — plus 9 untracked APK binaries (58 MB),
`New folder/` (8 exported photos), four `server-*.log`, `tmp_fix_routes.mjs`, and one-off test
scripts, each individually silenced by a hand-written `.gitignore` line. `git status` reports clean
because the junk drawer is enumerated in `.gitignore`, not because the junk is gone.
*Acceptance:* release binaries live in CI artifacts/Releases, source images under `docs/assets`,
dead scripts deleted; root keeps only README, CHANGELOG, EXECUTION_LOG, LICENSE, SECURITY, legal
docs; the rest move to `docs/archive/<period>/` with a supersession note.

**GOV-2 [P2] [✅] Four simultaneous version stories.** `version.json` says 1.4.0; `RELEASE_MANIFEST.md`
announces "v1.5.0 (candidate)" and cites a CHANGELOG `[1.5.0]` heading that **does not exist**
(CHANGELOG's newest release heading is `[1.3.7]` — verified); the on-disk APKs are v1.3.0–v1.3.7;
tags stop at `v1.3.0`.
*Acceptance:* `version.json` is the only version source; CHANGELOG gains real `[1.4.0]`/`[1.5.0]`
sections or the manifest is deleted; a `v1.4.0` tag + GitHub Release with the AAB attached.

**GOV-3 [P2] [✅] Commit identity is not traceable to a person.** All recent commits are
`AgroBridge Builder <builder@agrobridge.local>`, which no GitHub account owns.
*Acceptance:* commits authored by a real account (or an explicitly documented machine identity) so
sign-off and blame are meaningful.

### 5.2 Git history

**GOV-4 [P2] [✅] Good per-commit discipline, un-reviewable epoch commits.** 161/169 subjects are
Conventional Commits (95.3%); the Oct rounds are well-scoped (e.g. `1a682e6` = 3 files, +50/−12).
But the Sep epochs include `fb3fda5` ("final validated app state", 119 files, +4,142/−9,455) and four
more >40-file commits — those cannot be reviewed by anyone, ever. Two subjects are Bengali, two are
reverts, one is a bare `debug(api)` (all fine individually, inconsistent as a policy).
*Acceptance:* a stated commit-size norm in CONTRIBUTING (e.g. one concern per commit, ≤ ~25 files);
no further "state snapshot" commits.

### 5.3 GitHub configuration — the weakest area

**GOV-5 [P0-process] [✅] `main` has no branch protection.** `gh api …/branches/main/protection`
returns **404 "Branch not protected"**. Meanwhile `CONTRIBUTING.md` claims main is "protected", and
`docs/generated/governance-branch-protection.md` contains the exact intended configuration with the
status line *"DOCUMENTED ONLY — no API call executed (requires admin token)"*. Every commit in this
project's history — including the round-11 production flag change — went straight to `main`.
*Acceptance:* protection enabled from the already-written JSON (require PR, require CI + CodeQL
checks, dismiss stale reviews, no force-push, apply to admins) and the governance doc updated to
"ENFORCED (date)".

**GOV-6 [P1] [✅] CODEOWNERS protects a directory that does not exist.**
`.github/CODEOWNERS` line 1 is `/apps/api/payments/`; the real path is
`apps/api/src/modules/payments/` (verified: the listed path is absent). The payment module — the
domain an agency gates hardest — is therefore unowned; combined with GOV-5 it is doubly unprotected.

**GOV-7 [P2] [✅] Dependabot runs but nothing lands.** 9 PRs open since 2026-08-26 (checkout,
setup-node, upload-artifact, express-rate-limit, bcryptjs, react, autocannon, @types/node, multi),
~10 stale branches local+remote. Several of those bumps were adopted manually by SHA-pinning while
the PRs stayed open — i.e. merged through the back door, so the PR record is misleading.
*Acceptance:* every open PR merged, closed-with-reason, or pinned with the PR closed and the reason
recorded; branch cleanup; `dependabot.yml` reviewed for grouping.

**GOV-8 [P3] [✅] Zero issue tracking, no topics/homepage.** `gh issue list --state all` = 0 issues
ever; all defect tracking lives in markdown. The Play submission package even points data-deletion
requests at `…/issues/new` — an issue tracker that has never been used as one.

---

## 6. CI/CD

**CI-1 [positive] [🔎] `ci.yml` is genuinely professional.** 7-job DAG on `ci.yml` (9 jobs counting
CodeQL/Android), dual-database test chain (SQLite + PostgreSQL 17 service container running the
concurrency and security suites), blocking `npm audit --omit=dev --audit-level=moderate`, gitleaks,
Trivy on built images, every action SHA-pinned (after the fix below), `timeout-minutes`,
`concurrency: cancel-in-progress`, least-privilege `permissions`. Pass rate over the last 40 runs:
CI 13 success / 2 failure / 2 cancelled; CodeQL 18/18 — the failures are explained and fixed.

**CI-2 [P1] [✅] Deployment is not in the pipeline.** Production is deployed by the AI session
running `vercel --prod` from a shell, with no gate tying a deploy to a green CI run and no preview
environment in the path. `deploy-staging.yml` is a scaffold that has never executed. Round 11 added
`ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1` to the **production** environment from that same shell — a
money-path flag flipped on production by an unattended session, justified only in prose.
*This is the highest-risk process finding in the review.*
*Acceptance:* a `deploy-production.yml` requiring green CI + manual approval (or Vercel's Git
integration with a protected branch); the pilot flag documented in the runbook with an explicit
expiry (before Play submission) and removed from production at that point.

**CI-3 [P2] [✅] Evidence is disposed of.** Every verification number in EXECUTION_LOG
("149 passed / 1 skipped", "24/24", "39/39") was produced by tools that are committed — but the
resulting logs/artifacts live in gitignored `qa-evidence/`. An evidence-first process that discards
its evidence after each session is indistinguishable from an unaudited one.
*Acceptance:* either a committed `qa-evidence/receipts/<date>.md` capturing the command + headline
result per round, or a CI job that publishes the numbers as a durable artifact/status.

---

## 7. AI-work quality review (the primary lens)

This section judges the AI-produced work as a reviewer would judge a contractor's delivery. Credit
first, then the failures, then the systemic pattern.

### 7.1 What the AI rounds did well (verified)

- **Real defects found with real methods.** The launch round's five P0s (order-expand crash,
  discarded delivery address, unguarded sandbox payments in production, missing account deletion,
  debug-signed AAB) each carry a reproduction, a code-level root cause and a regression test.
- **Honest self-correction.** `EXECUTION_LOG.md` records its own failed claims, two reverts, a
  production incident ("login 500 for a few minutes"), and — in round 11 — two audit findings the
  agent *refuted* during verification rather than repeating (`/admin/analytics/summary` already had
  its permission gate; the VitePWA omission is deliberate).
- **Code quality of recent diffs is high.** `1a682e6` (the live-found `WEB_ORIGIN` redirect bug) is a
  clean fix: a pure, testable helper, a five-case regression test, and a commit message that states
  reproduction, cause and acceptance. That is better than most human hotfixes.
- **The discipline of writing down "why".** Non-obvious decisions carry their rationale where the
  next maintainer will read it (`payments/routes.ts:46-55`, `rateLimitRedis.ts:31-35`, `env.ts`).

### 7.2 Verified AI-work failures

**AI-1 [P0-process] [✅] A regression test existed only in a working tree and was then hidden.**
`apps/web/e2e/visual-contract.spec.ts` was **never committed to the repository** — `git ls-files`
lists no such path and `git log` for it is empty — while its **eight win32 pixel baselines *are*
tracked (`visual-contract.spec.ts-snapshots/*-chromium-win32.png`)**. The spec itself survives only
as an untracked `visual-contract.spec.ts.bak`, invisible to `git status` because `.gitignore:77`
ignores `*.bak`. Net effect: the repository shipped the baselines of a test that could not run, and
the test that produced them was never reviewable.

*Correction (2026-10-17, during Phase 0 remediation): this finding originally attributed the
removal to commit `0f20d89`. That commit is real and is about NGINX routing, but it did not touch
this file — the spec had never been in history, so there was nothing to rename. The first version
of this finding repeated an agent's claim without the `git ls-files` check; the corrected mechanism
is above. The severity and the remediation are unchanged.*

**This remains the most damaging process signal in the repository**: a test that only exists
untracked is indistinguishable from a test that was hidden.

**AI-2 [P1] [✅] A CI action pin was invented and shipped.** `actions/setup-node@…fe5028` does not
exist upstream (the real v7.0.0 commit is `…fe5020` — the last character differs). It survived the
agent's own verification because the check printed only 8 hex characters, so both rendered as
`82076278`. It sat in `ci.yml` and `android-release.yml` behind GitHub's resolution cache; the first
content change made the job die in "Set up job", and the only path that produces the Play AAB would
have failed on first real use. The agent diagnosed and fixed it well — but it wrote, verified,
shipped and re-verified its own pin with no second pair of eyes.

**AI-3 [P2] [✅] Prompt/checklist jargon leaked into shipped source.** `Rule 53`
(`apps/api/src/modules/disease/routes.ts:25`), `Rule 27/53` (`admin/routes.ts:23`), `Section 24/54`
(`providers/payment/types.ts:23`), `STEP 42` (`apps/web/src/App.tsx:21`), `STEP 55` twice
(`lib/offlineQueue.ts:32,113`) — references to a master prompt that does not exist in the repository.
The next engineer cannot decode them. (The Bengali strings in code are legitimate product i18n and
are *not* a finding; the AI rounds' *why*-comments are good and are also not a finding.)

**AI-4 [P3] [✅] Unproofread output shipped into the permanent record.** `EXECUTION_LOG.md:272`
contains stray CJK characters mid-sentence (`IconButton/c统一 chip`) — a model artefact committed
without reading.

**AI-5 [P2] [✅] Claims drifted from countable facts.** Round 11's log states the repository has 182
commits; the actual count is 169 on HEAD / 184 across refs (verified). The README still advertises
148 API tests after the round that made it 149. Both are small, and both are the same disease: prose
asserted instead of measured.

**AI-6 [P2] [✅] Documentation the AI wrote was not kept true where it stopped looking.** Verified
drift: `docs/database.md` says "change the provider in `apps/api/prisma/schema.prisma`" and
"25 tables" (the schema has 30 models and the real production path is the dual-schema pipeline
documented only in a log entry and the README); `docs/api.md` lacks `DELETE /auth/me`,
`POST /payments/gateway/return/:outcome` and `GET /payments/:id/status` — the endpoints the Play
compliance work is built on; `docs/UI_UX_CONTRACT.md` still describes a `src/pages/` tree that does
not exist and cites line numbers that no longer match.

### 7.3 The systemic pattern

Every failure above is one failure: **one agent wrote, verified, shipped and re-verified its own
work, with no independent reviewer and no machine gate that could overrule it.**

- The invented SHA (AI-2) passed because the *verifier was the author*.
- The disabled test (AI-1) passed because *no gate required a test to exist*.
- The free-payments path and the debug-signed AAB shipped for seven releases because *no reviewer
  read the diff* — and both would have been caught by a single review question ("what signs this
  artifact?" / "what stops a user confirming their own payment?").
- The doc drift (AI-6) is what happens when the same author decides what is "done".

Mitigating factors, stated fairly: the repository has real CI with real gates, the agent's own logs
are unusually honest, and the round-10/11 work demonstrates the agent *does* find and fix its
predecessors' defects when explicitly pointed at a dimension. The missing ingredient is not
capability; it is **an independent gate**.

### 7.4 Institutional memory

What exists: `EXECUTION_LOG.md` (11 rounds, honest), `docs/PLAY_STORE_LAUNCH_PLAN.md` (an
evidence-backed register with file:line for every finding), `ENTERPRISE_CERTIFICATION_STATUS.md`,
three runbooks, the Play package, 21 dated generated reports.
What is missing: **one ADR** in `docs/adr/` (the load-bearing decisions — no query library,
localStorage tokens, dual-dialect Prisma with the Vercel `postinstall` switch that already caused a
production login outage, provider-adapter boundaries — are recoverable only by archaeology through
log prose). For a handover to a human team, this is the difference between a weekend and a fortnight
of ramp-up.

---

## 8. Consolidated register (basis for the final development phase)

> **Remediation status:** Phase 0 is implemented — see the addendum at the end of this document for what changed and the evidence. Items are marked `DONE` there; the register below is kept as the original finding record.

Severity: **P0** = fix before any further Play/release activity · **P1** = fix in the final
development phase · **P2** = should fix · **P3** = hygiene. Effort: S ≤ 0.5d, M ≤ 2d, L > 2d.

| ID | Sev | Finding | Effort | Acceptance criteria |
|---|---|---|---|---|
| GOV-5 | **P0** | No branch protection on `main` (404) while docs claim otherwise | S | Protection enabled from the existing JSON; PR + CI/CodeQL required; admin enforced; doc updated to "ENFORCED" |
| CI-2 | **P0** | Production deployed by shell from an unattended session; money-path pilot flag set in prod | S–M | Pipeline-gated deploy (or protected-branch Git integration); pilot flag documented with an expiry and removed before Play submission |
| AI-1 | **P0** | Visual-regression test disabled by rename; win32 snapshots | S | Spec restored with a portable baseline, or deleted with a commit message that says so |
| GOV-6 | **P1** | CODEOWNERS points at a non-existent path (payments unowned) | S | Path fixed; workflows + prisma + payments owned |
| API-1 | **P1** | API `strict: false` + `noImplicitAny: false` | L | `strict: true` in both configs, typecheck green, no new escapes |
| WEB-2 | **P1** | API contract hand-copied 33× incl. twin `Order` | M | Single typed contract module + a parity check; zero inline API interfaces |
| WEB-6 | **P1** | Modal focus trap steals focus per keystroke (booking, withdraw) | S–M | Deps stabilised; first component tests cover trap/Escape/restore/typing |
| WEB-11 | **P1** | No component tests; web coverage unconfigured | M | Component tests for `ui.tsx`; coverage thresholds at measured baseline |
| API-6 | **P1** | Triple Prisma schema; regex parity guard; dual migration chains | M–L | Single source or generated variant; parity enforced incl. indexes |
| WEB-1 | **P1** | Hand-rolled server state in 10 screens, 17 manual refetches | M–L | One typed data layer; no feature-level `load()`; stale-UI class eliminated |
| API-2 | **P2** | 133 `req.auth!`, 14 `as never` | M | Typed auth on gated routers; `as never` = 0 in payments |
| API-3 | **P2** | Three parallel module trees; `lib/errors.ts` dead | S | One canonical tree; dead file deleted |
| API-4 | **P2** | Rate-limit/role/audit policy ad hoc per module | M | Factory + `requirePermission` everywhere + stated audit policy applied |
| API-7 | **P2** | Missing indexes (Product, Order, AuditLog) | S | Indexes added in both dialects + migration + doc note |
| API-8 | **P2** | Redis limiter 2/46 lines; organizations 46% | M | Fake-Redis unit test; organizations coverage above floor |
| WEB-3 | **P2** | Wallet/Services/Admin blank on any single endpoint failure | M | Partial-failure semantics + actionable error copy |
| WEB-4 | **P2** | Offline queue queues GETs | S | Method-aware allow-list + tests |
| WEB-7 | **P2** | `inert` only on `#main` | S | Full-sibling inert/aria-hidden |
| WEB-10 | **P2** | Two i18n systems; ~73 hardcoded ternaries; checker blind to dynamic keys | M | AST-based checker; ternaries migrated; unused-key ledger near zero |
| WEB-13 | **P2** | 450 KB eager entry chunk | M | framer-motion lazy + per-language dictionaries; CI bundle budget |
| GOV-1 | **P2** | Root junk drawer (58 MB APKs, 21 overlapping reports, stray logs/scripts) | M | Archive/delete per §5.1; `.gitignore` junk rules removed |
| GOV-2 | **P2** | Four version stories; no tag/release since v1.3.0 | M | `version.json` single source; CHANGELOG sections; `v1.4.0` tag + Release with AAB |
| GOV-4 | **P2** | Un-reviewable epoch commits; non-personal commit identity | S | Commit norm in CONTRIBUTING; real author identity for sign-off |
| GOV-7 | **P2** | 9 stale Dependabot PRs + 10 branches | S | Triaged, merged or closed with reasons; branches deleted |
| CI-3 | **P2** | Verification evidence gitignored/disposable | S | Committed receipts per round, or CI-published numbers |
| DOC-1 | **P2** | `docs/api.md`, `docs/database.md`, `UI_UX_CONTRACT.md`, README stale | M | Each verified against code; correctness gate on the docs the next engineer reads first |
| AI-3 | **P2** | Prompt jargon in shipped source | S | `Rule n`/`STEP n` comments replaced with plain rationale |
| ADR-1 | **P2** | 1 ADR for 5 load-bearing decisions | M | ADRs for: data layer choice, token storage, dual-dialect Prisma, provider adapters, versioning |
| AI-4/5/6 | **P3** | Unproofread log artefact; claim drift; doc rot | S | Corrected in place; a "no claim without a command" note in CONTRIBUTING |
| WEB-5/8/9/12/14/15, API-5, GOV-3, GOV-8 | **P3** | Dormant session API · sub-44px header controls · keyboard-invisible card · ESLint 8 EOL · dead deps/scaffolding · inline pricing · issue tracking | S each | Per finding, as listed in §3–§6 |

---

## 9. Recommended sequence for the final development phase

**Phase 0 — Governance, config and deletions (≈1 day, no product-code risk).**
GOV-5, GOV-6, AI-1, CI-2, GOV-7, GOV-2 (tag/release), CI-3. After this phase the repository has a
gate that can overrule its own author — the precondition for everything else being safe.

**Phase 1 — Correctness of the contract (≈2 days).**
WEB-2 + WEB-1 (one typed contract + one data layer, which mechanically removes most of WEB-3 and
shrinks the feature files), then API-1 (strict types) with the API-2 escapes paid down inside the
same touch. These three interlock: the contract layer is what makes strict typing cheap.

**Phase 2 — Accessibility and the UI safety net (≈1.5 days).**
WEB-6, WEB-7, WEB-11, WEB-8, WEB-9. The Modal is the highest-risk interaction in the app (booking,
withdraw, delete-account) and currently has zero tests.

**Phase 3 — Data layer and operational hardening (≈2 days).**
API-6 (single-source schema), API-7 (indexes), API-8 (limiter/organizations tests), API-3, API-4,
WEB-4, WEB-13.

**Phase 4 — Documentation and institutional memory (≈1 day).**
DOC-1, ADR-1, AI-3, GOV-1, plus the receipt convention so the next review starts from evidence
rather than archaeology.

**Definition of done for the phase:** CI green on a protected `main` via PR; no P0/P1 item open;
`strict: true`; one schema source; component tests present for the Modal contract; docs verified
against code; a `v1.4.0` GitHub Release carrying the AAB; and a written statement in
`docs/play/release-runbook.md` that the sandbox-payments pilot flag is removed from production
before the Play submission.

---

## 10. Limitations of this review

- Line-level coverage percentages quoted for individual API files (e.g. `organizations/routes.ts`
  46%) come from the generated `coverage/lcov.info` **as reported by a review agent** and were not
  re-derived by re-running coverage in this pass (🔎, not ✅). The configured thresholds and the
  aggregate measured numbers in `vitest.config.ts` were read directly (✅).
- The Git-history assessments (epoch commit sizes, tag/release state, Dependabot backlog) were
  reproduced with local git and the GitHub API on 2026-10-17 (✅); GitHub's org-level settings,
  secret values and Vercel project settings are not inspectable from here and are out of scope.
- No dynamically-verified claims are made about runtime performance or load behaviour; nothing in
  this review was load-tested.
- The review deliberately excludes re-litigating the product decisions recorded in the Play plan
  §E (localStorage tokens, R8 disabled, no FCM) — those are owner decisions with stated reasons,
  not quality defects.
