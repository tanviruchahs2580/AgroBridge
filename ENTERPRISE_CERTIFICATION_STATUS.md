# AgroBridge — ENTERPRISE CERTIFICATION STATUS

**Authoritative certification record.** Single source of truth per the 2026-09-15 enterprise
certification engagement. Older root reports (`ENTERPRISE_MASTER_REPORT.md`,
`FINAL_ENTERPRISE_VALIDATION_REPORT.md`, `PRODUCTION_CERTIFICATION_REPORT.md`, etc.) are
historical and superseded by this file where they conflict.

- **Date:** 2026-09-15
- **Auditor:** ZCode agent (independent audit + remediation engagement)
- **Baseline commit:** `524c3a1` (local HEAD == origin/main; **no commits/pushes/CI runs were
  performed during this engagement** — all changes are uncommitted working-tree changes by
  explicit instruction)
- **Release status:** 🔶 **NOT YET CERTIFIED — conditional** (score below). One deploy cycle
  + two operator decisions stand between current state and 100/100.

---

## 1. Verdict

```
Local (working tree)  : P0 = 0   P1 = 0   P2 = 0 (all fixed & tested)
Live (deployed)       : P0 = 2 open (remediated in code, not deployed / needs human action)
Certification gate    : 12 of 14 local gates PASS; production smoke + live sync = FAIL (drift)
Evidence-based score  : 90 / 100
```

**100/100 is honestly withholdable today** because the deployed environment does not yet
contain the fixes made in this engagement (deploy is explicitly out of scope per the
engagement instruction) and two items require human/organizational decisions. When those
are done, every remaining gate can be re-run from the commands in this file.

## 2. Open items requiring user action (blocking 100/100)

| ID | Severity | Item | Required action | Why it is not agent-fixable here |
|---|---|---|---|---|
| CERT-01 | **P0 (live)** | Live Render DB contains SUPER_ADMIN/ADMIN `Demo@1234` accounts; verified login works and admin list read succeeds on the live API. | **Immediately** lock/rotate the 5 demo accounts in the production DB (change passwords / set `status` non-ACTIVE), then deploy the seed production-guard added in this engagement so no future deploy re-seeds them (`ALLOW_DEMO_SEED` opt-in now required). | Deployment + production-DB mutation are out of this engagement's scope (no push/deploy authorized). |
| CERT-02 | **P0 (repo history)** | Three committed DR-rehearsal `apps/api/backup-*.json` files contain 244 users' bcrypt hashes, 283 refresh-token hashes and profile PII (public repo). | (a) git-history purge (`filter-repo` + force-push — needs explicit authorization), (b) treat hashes as leaked: rotate admin service credentials & invalidate refresh tokens, (c) confirm whether those 244 users are real or synthetic. Working tree already fixed: files untracked + `.gitignore` rule added. | History rewrite = prohibited without user decision. |
| CERT-03 | P2 | `.env.local` contains a full `VERCEL_OIDC_TOKEN`; root `.env` has live-looking local secrets (both correctly gitignored). | If that token is real, revoke/rotate it; never reuse this worktree's env files for shared environments. | External revocation only. |
| CERT-04 | P2 | 125 files of uncommitted change (this engagement's fixes + the user's in-flight web refactor `pages/→features/` restructure). | Review (`git diff`), commit and push; then CI + staging/production deploy must be executed by the user (engagement rules: agent must not push/commit/run CI). | Push/commit/CI explicitly prohibited. |
| CERT-05 | P3 | Repo hygiene: 8 debug APK binaries (~54 MB) tracked in git; `tmp_fix_routes.mjs`, `server-*.log`, `New folder/` are untracked cruft in the working tree. | Remove APKs from tracking (build them in CI instead — `android-debug-apk.yml` already exists); delete cruft files. | Deleting tracked user content requires owner decision. |

## 3. Findings fixed during this engagement (all regression-tested)

| ID | Sev | Finding | Fix | Proof |
|---|---|---|---|---|
| W-01 | P1 | **Withdrawal double-spend race** — request handler read `SUM(PENDING+APPROVED)` then inserted; two parallel requests could both pass (`payments/routes.ts`). Also APPROVED-without-debit was double-counted. | `Wallet.heldPaisa` column (dual schema + **dialect-correct migration chain**); reservation under the wallet row's write lock (SQLite serialized tx / PG row lock via locking upsert); APPROVE debits+releases, REJECT releases; summary reads hold; reconcile script checks `heldPaisa == ΣPENDING`. | `tests/withdrawal-race.test.ts` (4 tests incl. 2×parallel-90% requests → exactly 1 pass, 5-way race, reject-reapproves) — pass on SQLite **and** PG. |
| W-02 | P1 | **MyOrders permanently empty (P0-class product bug)** — UI expects `{items}`, API returns plain array; silent catch. Live bundle `MyOrders--8DkkPmX.js` still contains the broken call → **users on the live app see an empty order list**. | Consumer now handles both shapes; live API probe confirmed identical contract on production. | Playwright T8: places order via checkout wizard, asserts the order number appears in MyOrders. Pass. |
| W-03 | P1 | **PG oversell test never ran locally** — concurrency suite `it.skipIf(!isPostgres)`; no PG instance present. | Full PG validation performed (docker postgres 17-alpine, provision script, both suites). | PG profile **132/132, 0 skipped**, incl. 8-buyers/5-stock oversell test, payout-once, booking assign-once. |
| W-04 | P1 | **`prisma migrate deploy` cannot target PostgreSQL** — single SQLite-only migration chain; Render `preDeployCommand` was guaranteed to fail on a fresh PG; docs claimed portability (false). | Generated `prisma/postgres/migrations` chain + `schema.prisma` copy (`db:migrate:pg` script); updated `render.yaml`, compose docs, deployment guide; `tests/schema-parity.test.ts` guards schema drift between dialects. | Fresh PG DB: `migrate deploy` applies cleanly, idempotent on re-run; parity test green. |
| W-05 | P2 | No per-route limits on financial endpoints. | `financialLimiter` (20/h/user, Redis-aware) on `/payments/intent` + `/wallet/withdrawals`; `checkoutLimiter` (40/15min) on `/orders/checkout`. | Security-matrix suite extended pattern already exercised AI limiter; envelope/429 behaviour verified via matrix script. |
| W-06 | P2 | Production API image ran as **root**. | `docker/api.Dockerfile`: `USER node`, uploads dir pre-owned. | Rebuilt image: `whoami` = `node`; scan 0C/0H/0M. |
| W-07 | P2 | Dependency vulns: `qs` (2×MEDIUM via express/body-parser) and `deepmerge-ts` chain via `@prisma/config` (HIGH). | Root `overrides`: `qs@^6.16.0`, `deepmerge-ts@^8.0.0`; full reinstall verified `@prisma generate`, `migrate deploy` (both dialects) still work. | `npm audit --omit=dev` → **0 findings** (was 3 high + 2 med). CI gate upgraded: prod deps now **fail** the build on moderate+ (was warning-only). |
| W-08 | P2 | **Seed re-created demo ADMIN accounts on every production deploy** (render preDeploy runs `db seed`). | Seed production guard: skips unless `ALLOW_DEMO_SEED=1`. | Executed: `NODE_ENV=production tsx prisma/seed.ts` → skips; dev path unchanged (e2e seeds still work). |
| W-09 | P2 | Web image: nginx:alpine with 4 fixable HIGH (util-linux/libxml2). | `nginx:1-alpine-slim` + `apk upgrade`. | Rebuilt image scans 0C/0H; container smoke: serves SPA, `/health` proxy, `/market` fallback. |
| W-10 | P3 | Dead duplicated upload-handler `aiagent/disease.ts` (byte-identical, zero importers) + dead `wallet.service.ts` / `refund.service.ts` (no consumers; real paths already transactional). | Removed all three. | Typecheck, lint, full suites pass after removal. |
| W-11 | P2 | **A11y contrast failures** — unread badge and money-debit figures used `#ef4444` on light (~4.0:1 < 4.5 AA). | Semantic `text-danger-text` (`#991b1b` light / `#fca5a5` dark, ~7.8:1) across Home/Market/SellCrop/Services/Wallet. | axe e2e scan: zero critical/serious on `/`, `/market`, `/wallet`. |
| W-12 | P3 | E2E harness false-green risk — `expect(a) || expect(b)` broken patterns, vacuous `if-present` skips, `localhost`→::1 cross-app contamination (a *different* app on the machine served 5173 during QA). | `gui-e2e-test.spec.ts` rewritten (shared `checkoutOneItem()` helper, hard assertions, Done-button closes wizard, T8 asserts the placed order number); config/specs bind `127.0.0.1`. | 20/20 Playwright on IPv4; baseline (pre-fix) 18/20 failure logged as evidence. |
| W-13 | P3 | Live-vs-local verification surfaced stale doc URL — docs name `agrobridge-api-node.onrender.com` (404), real live service is `agrobridge-vfbz.onrender.com`. | Recorded here; bundle fingerprint `index-CNt0gECS` matches HEAD → deployed version == `524c3a1`, and **all W-0x fixes are therefore NOT live yet**. | Probes (GET-only): `/health` `/ready` `/api/v1/orders`(401) 404-envelope `ROUTE_NOT_FOUND` all match local behaviour. |

### Explicitly verified as NOT broken (corrects earlier sub-agent hypotheses)
- Prisma `update` with a non-unique guard predicate (`{ balancePaisa: { gte } }`) **does**
  enforce it — throws P2025 → transaction rollback (empirical probe on scratch DB). The
  "ineffective atomic guard" hypothesis for `wallet.service.ts`/`refund.service.ts` was wrong
  (files additionally proved to be dead code).
- Checkout stock decrement is genuinely atomic (`updateMany` conditional claim) — proven by
  the PG 8-buyers/5-stock race test.
- Webhook replay is safe: signature check + atomic PENDING→SUCCEEDED claim; idempotent on
  already-final payments.
- Offline queue: clientUuid + payload-hash dedupe, server-side `clientUuid` idempotency on
  farm events; offline banner e2e passes.
- AI eval: BN/EN/Banglish retrieval, refusal of out-of-domain, injection resistance,
  dosage-safety — 7 behavioural eval tests green; measured via offline engine (the live
  provider is intentionally `offline` on Render).

## 4. Validation gates (final re-audit run, 2026-09-15)

| Gate | Result | Evidence (local artifact) |
|---|---|---|
| Lint (api+web) | PASS (0 errors 0 warnings) | eslint exit 0; web warning fixed |
| Typecheck (api+web) | PASS | tsc both workspaces |
| Unit+Integration SQLite | **PASS 131/132** (1 skip = PG-gated by design) | `qa-evidence/G2-api-tests-definitive.log` |
| Unit+Integration **PostgreSQL** | **PASS 132/132, 0 skips** | `qa-evidence/G3-pg-tests-definitive.log` |
| Coverage thresholds | PASS (84.45/67.33/89.53 ≥ 75/63/73/75 after dead-code removal) | `A6-api-tests-after-c1c2.log` |
| Web unit | PASS 107/107 | vitest web |
| Build (api+web) | PASS | `index-1NCEnT95.js` 469 kB (149 kB gz) |
| E2E (Playwright, mobile 390px bn) | PASS 20/20 | `qa-evidence/G4b-e2e-definitive.log` (definitive, after all fixes) |
| API parameter matrix (user-level, 82 checks across 14 groups) | PASS 82/82 | `F2-param-matrix.log` |
| Security: secret scan / headers / 413 / IDOR / RBAC / refresh-reuse | PASS (verified by tests + matrix) | security-matrix, auth-hardening |
| Dependency audit | prod **0**, dev-only 8 moderate (waived, expired-risk tracked) | `SECURITY_WAIVERS.md` |
| Container scan | api 0C/0H/0M non-root; web 0C/0H | docker scout logs |
| Performance (local dev-profile, SQLite, autocannon) | health 7.6k rps p99 4ms · products p99 35ms · login p50 841ms (bcrypt cost, by design) · weather p99 19ms | `P1-loadtest-local.log` — **dev-profile only, not a production capacity claim** |
| Backup/restore DR | PASS — full logical dump → scratch PG → 100 % row-integrity verified; **backup 336 ms / restore 538 ms** at current dataset size | `backup-restore-rehearsal.mjs` run log |

## 5. Accepted-risk register (with compensating controls)

| Risk | Sev | Control | Owner | Review |
|---|---|---|---|---|
| SSLCommerz webhook signature is MD5 (provider-mandated algorithm) | P3 | Atomic idempotent claim limits replay damage; provider spec cannot change | platform | on provider SDK update |
| Refresh token in `localStorage` (XSS exposure) | P2 | No `dangerouslySetInnerHTML`/eval found anywhere in src; CSP headers; single-flight rotation + family revocation; server status re-check per request | platform | revisit when httpOnly-cookie auth lands |
| PWA service worker intentionally disabled (manual probe) | P3 | Offline queue + banner proven by e2e; Capacitor WebView ships the shell | product | re-evaluate on web-first launch |
| `authorization/policy.ts` scaffold unused (routes use live `rbac.ts` matrix) | P3 | Permission matrix centralised in `rbac.ts`; both covered by security-matrix tests | platform | consolidate on next authz change |
| Anonymous catalog browsing unavailable | P3 | **By design** — entire SPA redirects to `/login`; see ADR-0001 | product | revisit when public marketing page exists |
| Dev-tooling moderate audit findings (vitest/autocannon/capacitor-cli) | P3 | `--omit=dev` production tree = 0; CI prod-audit gate fails on moderate+ | platform | 2026-12-31 |

## 6. Scorecard (evidence-based, not aspirational)

| Dimension | Score | Basis |
|---|---|---|
| Architecture | 9/10 | Modular monolith, provider abstraction, parity guards; no ADR for SW decision beyond this session |
| Code quality | 9/10 | 0 ts-ignore, 0 errors, 14 documented hook-deps; dead code removed |
| Database & integrity | 9/10 | Dual dialect + PG-verified concurrency; backup rehearsal real; no automated retention yet |
| API | 9/10 | Uniform envelope, pagination, limits, idempotency; webhook MD5 noted |
| Security | 8/10 | Scans clean, headers, upload sniffing; localStorage token, repo-history PII open |
| Auth/RBAC | 9/10 | Matrix + IDOR + rotation/reuse tests; live demo creds open (deploy-gated) |
| AI/RAG | 8/10 | Eval suite incl. BN/Banglish/injection/refusal/dosage on offline engine; no hosted-LLM eval (provider unconfigured) |
| Offline | 4/5 | Queue dedupe, server idempotency, banner+e2e; no SW cache |
| Marketplace/Procurement | 5/5 | Oversell proven on PG; payout-once; state claims atomic |
| Testing | 4/5 | 132 PG / 20 e2e / 82 matrix; frontend unit depth still thin (5 files) |
| DevSecOps/CI-CD | 4/5 | Gates hardened, but fixes unverified in actual CI execution (out of scope here) |
| Observability/SRE | 4/5 | Metrics/alerts/redaction wired; tracing deferred (single node) |
| Disaster recovery | 4/5 | Scripted rehearsal passes with measured RPO/RTO proxies; no full outage drill |
| Performance/Scalability | 4/5 | Local profiles honest; production-scale load & pool tuning pending deploy |

**Total: 90 / 100.**

**To reach 100:** (1) commit/push/deploy → CI + production smoke green, (2) execute CERT-01…CERT-03
rotations, (3) one production-scale load test + one real outage-restore drill, (4) frontend
unit uplift. Each is measurable with the commands in this file.

## 7. Last validation

2026-09-15, against working tree over `524c3a1`. **Next review:** at the first post-deploy CI
run + staging smoke, then quarterly with `docs/operations.md`.

---

## 8. Post-deploy addendum — 2026-09-16 (push + live re-verification)

Work landed and verified this session; supersedes the "not deployed" caveats in §1–§2 where
noted.

**Repo / CI**
- Pushed `24fcb2d..4adbc4f` to `origin/main`. CI run
  [#35064526113](https://github.com/tanviruchahs2580/AgroBridge/actions/runs/35064526113)
  completed **success** — all 9 jobs green (API SQLite, API PostgreSQL, Web typecheck/build,
  Web E2E, Android APK, dependency audit, gitleaks, Docker build, Trivy). CodeQL also success.
  This is the first fully green CI on `main`: the three prior failures were all the Docker
  "Build Web image" step, fixed by `5cd1714` (`npm ci --workspace apps/web
  --include-workspace-root`).
- Local gates re-run on `4adbc4f`: typecheck + lint clean (api/web); API 131 pass / 1 skip
  with coverage **85.21 % stmts / 67.33 % branch / 89.53 % func** (gates 75/63/73); web 107
  pass; i18n 0 missing; vite build OK; Playwright E2E **20/20**; prod `npm audit` 0 vulns.
- QA harness `api-full-validation.sh` (gitignored, local-only) was repaired this session: it
  generated 10-digit phones (API requires 11), aborted on the first non-2xx because of
  `set -e`, treated ADR-0001 auth-gated routes as public, and parsed `plotId` from the wrong
  response. Final matrix: **43/43 (100 %)**. Evidence: `qa-evidence/I2-param-matrix-2026-09-16.log`,
  `qa-evidence/I3-api-coverage-2026-09-16.log`.

**Live version sync**
- Web (Vercel): bundle `index-c0QkYbd7.js` and title `AgroBridge — AI কৃষকের হাতে` match the
  local build exactly; `/sw.js` kill-switch served (200, 1443 B). Live == HEAD for the web.
- API (Render `agrobridge-vfbz.onrender.com`): `/health` + `/ready` green; login works; 7 of 8
  probed authenticated endpoints return 200; RBAC negative checks correct (farmer → `/admin/*`
  = 403, no token = 401).

**NEW OPEN ITEM — CERT-06 (P0 live)**

| ID | Severity | Item | Required action |
|---|---|---|---|
| CERT-06 | **P0 (live)** | `GET /api/v1/wallet/` and `GET /api/v1/wallet/summary` return **500 INTERNAL_ERROR** on the live API. All other probed endpoints return 200. | Apply the `heldPaisa` migration to the live PostgreSQL DB. See root cause below. |

Root cause (evidence-based, not hypothesis): the deployed API code references the `Wallet.heldPaisa`
column (introduced in `fb3fda5`, v1.3.9 — confirmed with `git log -S heldPaisa`), but the live
database does not have that column. Both failing endpoints touch the `Wallet` row
(`/wallet/` via `upsert`, `/summary` via `findUnique` selecting `heldPaisa`); every probed
route that does **not** read `Wallet` returns 200. Why the migration never ran: this Render
service was created through the dashboard (see the standing WARNING in `render.yaml`), so the
`preDeployCommand` declared in `render.yaml` — which runs `scripts/deploy-migrations.mjs`,
the baseline-aware dialect-aware deploy that applies the `heldPaisa` ALTER — is not applied to
the live service. `render.yaml` is therefore not authoritative for it.

Fix (requires Render account access, not available from this workstation — no `render` CLI,
no `RENDER_*` credentials, and the live `DATABASE_URL` is a Render-injected secret):
1. In the Render dashboard, set the service's **Pre-Deploy Command** to
   `cd apps/api && node scripts/deploy-migrations.mjs && npx prisma db seed`, then trigger a
   deploy; or re-create the service from `render.yaml` (Blueprint) so the declared command
   takes effect. The script is idempotent and baselines the dashboard-created DB correctly.
2. Verify: `GET /api/v1/wallet/summary` with a farmer token returns 200 with
   `monthCreditsPaisa / monthDebitsPaisa / pendingWithdrawalsPaisa / membership`.
3. Re-run §4 gates; the two live P0s in §2 (CERT-01 demo creds, CERT-02 history) still stand.

**Also observed (housekeeping, non-blocking):** GitHub Actions annotations warn that
`actions/checkout` and `actions/setup-node` pins target Node 20, which is being force-run on
Node 24 and is removed from runners on 2026-09-23. Bump those action pins before that date.
The Dependabot branches for these bumps already exist in the repo.
