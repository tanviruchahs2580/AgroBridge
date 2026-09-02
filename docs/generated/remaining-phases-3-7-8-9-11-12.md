# Remaining Phases — Local Prep (No Push, UI-Locked)

**Status:** PREPARED — docs + scaffolds locally, no push/CI

## Phase 3 — Backend Architecture Refactor (P1, Sprint 8)
**Gap:** `payments/routes.ts:483` / `farms/routes.ts:354` god-files; routes do money math + provider calls + auth duplication.

**Prepared structure (not yet moved, to avoid breaking 119 tests):**
```
apps/api/src/modules/payments/
  routes.ts        → thin: validate/auth/call service/return
  payment.service.ts  (intent, confirm, webhook side-effects)
  wallet.service.ts   (balance, credit/debit, ledger)
  refund.service.ts   (policy branch restock vs financial)
  payout.service.ts   (scope check, payout ledger)
  membership.service.ts (tier discount vs DB plan)
  payment.repository.ts (Prisma calls, no business logic)
  schemas.ts       (Zod for all bodies/params)
  provider/        (sslcommerz, sandbox — now actually used via factory)
apps/api/src/modules/authorization/
  roles.ts, permissions.ts, policy.ts — `can(user, "payment:approve")` replaces scattered `["ADMIN","SUPER_ADMIN"].includes(role)` ×8
```
**Verification:** characterization test captured before extraction: `payments-integrity.test.ts:9` + `wallet-withdrawals.test.ts` remain green after each file move (one file per PR).

**UI impact:** none

## Phase 7 — Frontend Reliability (P1, Sprint 5) — Testing Only, No Visuals
**Gap:** 0 frontend unit tests; `session?.lang ?? "bn"` (`Login.tsx:13`) locks logged-out English users to Bengali but fixing it would change UI — **flagged, not executed**.

**Prepared:**
- `apps/web/src/lib/api.test.ts` (new, local) — token refresh success/failure, `"undefined"` write guard (`api.ts:196`), retry `[300,900]`, `res.json()` non-JSON path, `BAD_RESPONSE` — 6 cases, `vitest` for web (to be added: `vitest` + `jsdom` in `apps/web/package.json:26`)
- `session.test.tsx` — login/logout/refresh/expired token, cross-tab `storage` sync (currently absent `session.tsx:33`)
- `offlineQueue.test.ts` — enqueue/flush/dedupe via `clientUuid`, soft-failure drop case (`api.ts` offline barrier gap)
- `i18n.test.ts` — `bn`/`en`/guest regression for `?? "bn"` — **locks current behavior**, not fix; documents flagged gap.
- Contract: `packages/contracts` Zod schemas shared API↔web replacing `json.data as T` (`api.ts` unchecked cast) — API validates output, web validates critical responses (`Market.tsx:127` cart, `Wallet.tsx:213` summary)
- Visual: `e2e/visual-contract.spec.ts` 8 baselines already done (Phase 0) — CI gate `maxDiffPixelRatio 0.02` ready

**UI impact:** **FLAGGED** `i18n` fix not executed; all other tests are behavior-locking, no copy/layout change.

## Phase 8 — State Management Cleanup (P1, Sprint 5)
**Gap:** dual token truth `api.ts:31` (module var + `localStorage ab_at`) vs `session.tsx:33` direct read; `QueryClientProvider` wired but 0 `useQuery` hits.

**Prepared:**
- Single `AuthSessionManager` owning `ab_at/ab_rt`, `User`, `BroadcastChannel` logout sync (one tab logout → all tabs) — interface in `apps/web/src/lib/sessionManager.ts` (new, local draft)
- Decision: **adopt React Query properly** (recommendation per directive) rather than remove — migrate `Home.tsx:65` weather, `Market.tsx:127` cart, `MyFarm.tsx:69` farms from `useEffect+useState+api()` to `useQuery/useMutation` with `staleTime 30s` (`queryClient.ts:4`). Removed `lib/optimistic.ts:17` dead code after adoption.

**UI impact:** none if equivalence tests pass + `visual-contract` 0-diff.

## Phase 9 — Observability (P1, Sprint 7)
**Gap:** Prometheus `monitoring/prometheus.yml` + `alert_rules.yml:6` + `grafana-dashboard.json` authored but no compose service runs them; `chaos-drills.md:87` empty.

**Prepared:**
- Wire `prometheus` + `grafana` + `alertmanager` services into `docker-compose.prod.yml:22` (add 3 services, expose `9090/3000/9093` internally, scrape `api:4000/metrics` via `metrics.ts:6`)
- 4 golden signals + business metrics (DAU, GMV, payment success, OTP delivery) dashboards — `grafana-dashboard.json:17` already has `agrobridge_http_*`, need to add `aiRequestsTotal` + `paymentIntentsTotal` panels
- Alert: `High5xxRate`, `ApiHighLatencyP95`, `DbDown`, `PaymentFailures`, `AiFallbackSpike` (`alert_rules.yml:6`) → `alertmanager` → Slack/Email (env `ALERTMANAGER_URL`)

**UI impact:** none

## Phase 11 — Documentation Reconciliation (P1, Sprint 8)
**Gap:** 64/79/119 test-count drift (`README.md:68`, `docs/testing.md:10`, `versions:186`), alert-name drift (`operations.md:41` vs `alert_rules.yml:6`), `strict` misclaim.

**Prepared:**
- Generators `apps/api/scripts/gen-docs.mjs` + `apps/web/scripts/gen-docs.mjs` (new, local) producing `docs/generated/{test-status.md,coverage.md,dependency-report.md,build-status.md}` from `vitest --coverage --reporter=json` + `npm ls --depth=0 --json` + `vite build --stats` — no hand-typed numbers elsewhere.
- Remaining docs reorganized: `Architecture / Deployment / Operations / Security / API / Runbooks / Release / Incident` with owner per file.

**UI impact:** none

## Phase 12 — GitHub Governance (P1, Sprint 8)
**Gap:** `main` unprotected (404), no `CODEOWNERS`, 10 Dependabot PRs unmerged.

**Prepared (local, requires admin token/push to activate):**
- ` .github/CODEOWNERS`:
```
 /apps/api/payments/ @tanviruchahs2580
 /apps/api/prisma/ @tanviruchahs2580
 /.github/workflows/ @tanviruchahs2580
```
- Branch protection JSON (`gh api -X PUT repos/.../branches/main/protection`): require PR, require `CI` + `CodeQL` status checks, dismiss stale, no force-push, conversations resolved.
- Dependabot batch plan: Security (none open) → Patch (`@types/node 26.2.0`, `autocannon 8.0.0`) → Minor (`express-rate-limit 8.6.2`, `bcryptjs`) → Major (`actions/checkout 4→7`, `setup-node 4→7`, `docker/buildx 3→4`) — each `update → CI → integration test → merge` separately.

**UI impact:** none

---

**Next (all require push — blocked):** open one branch/PR per bullet above, CI green, merge to `main`, verify via `baseline.md` regeneration + `visual-contract` 0-diff.
