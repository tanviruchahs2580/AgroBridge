# Current condition re-audit — scored on the V2 catalog

**Date:** 2026-10-21 · **Tree scored:** `fix/audit-10k-hardening` @ `913839d` (7 commits of
10k-audit remediation on top of `main @ 0ce54b5`) · **Scorer:**
`python docs/qa/score-current.py` (committed; reproducible from the repo alone)

## Verdict

**37.68 / 100 — band "below 60: prototype / at risk" on the V2 catalog's own scale.**

That number is the *current tree's* score on exactly the criteria the last full audit used (the
113-parameter V2 catalog, weights, formula and caps unchanged, scorer committed alongside this
report). It is not a regression against anything: it is the honest position of the tree that is
actually checked out.

**The single fact that explains the number:** the last full audit remediated the catalog from
32.22 → 63.13 (waves W1+W2, 30+ commits), and that work is **still sitting unmerged in
PR #40** (`audit/v2-remediation` → `main`, state `OPEN`, verified with `gh pr view 40`).
The three representative remediation commits — resilience policy (`1225b1f`), bundle+CI gates
(`9d51534`), threat-model docs (`ce1a7c1`) — are provably not ancestors of the current tree.
The current tree is the audit's own G0 baseline plus the 10k-hardening wave this same
engagement produced.

**What the 10k hardening wave added to the score:** +0.46 (37.22 → 37.47 base + claims) —
ARC-06 0→1 (instance/pool knobs plus a measured 10k capacity table where the audit found a
blanket disclaimer) and QAT-07 0→1 (the 10k-session and overload drills the parameter asked
for, executed and reported, unautomated). It also resolved all five wave-0 doc-claim penalties
(−5 → −0) and, more importantly, closed six defects the catalog does not even measure
(production image shipping 23 development databases, the IP-keyed AI quota that broke the
feature behind carrier NAT, a login burst that starved the instance for 60 s, and three more —
`docs/qa/2026-10-21-load-10k-and-condition-report.md`).

**Also verified today, unchanged and green:** typecheck (api+web), API suite **373/373**
PostgreSQL 17 and **372 passed + 1 skipped (by design)** on SQLite, web unit **166/166**,
eslint, i18n, production build, byte-budget preflight, end-to-end smoke **29/29** on the built
production image.

## Scorecard

| Domain | Score | Max | Points |
|---|---:|---:|---:|
| ARC | 26 | 80 | 6.50 |
| SEC | 27 | 48 | 6.75 |
| API | 18 | 44 | 4.91 |
| SLP | 21 | 56 | 3.75 |
| QAT | 17 | 48 | 3.54 |
| CID | 18 | 40 | 3.60 |
| OPS | 9 | 36 | 2.00 |
| WEB | 15 | 40 | 3.00 |
| DOC | 10 | 36 | 1.67 |
| PRD | 7 | 24 | 1.75 |
| **Total (uncapped → capped)** | | | **37.47 → 37.68** |

Score still moves when the wave-0 penalisers are resolved: AUD-165 is an open **S1** (caps ≤55),
nine open **S2**s taper toward 70, and UAT (P4) is incomplete (caps ≤75).

## The deciding factor, stated plainly

The largest single improvement available to this repository is a review-and-merge decision,
not new code: **PR #40 carries +25–26 catalog points** and 30+ commits of already-produced
work. Once it lands on top of this branch (or this branch lands with it), the tree is in the
60–70 band *before any new engineering*.

## Remaining fixable issues (in-repo work — no owner actions)

Ordered roughly by points-per-effort; the parameter ID is the catalog row each item satisfies.

**Group A — cheap, high-leverage (each ≤ half a day)**
- `SEC-11` rate-limit the disease/image upload route and document the store (AUD-140 store
  fault-open stays until Redis).
- `API-03` run wallet reconciliation against a scratch DB as a test (clean → 0 mismatches).
- `CID-06` pre-merge migration-drift job + licence gate + Lighthouse budget job (files already
  exist; wiring only).
- `SLP-07`/`CID-10` commitlint, issue templates, Dependabot groups + docker file coverage.
- `DOC-02` owner/purpose/last-verified banners on the core docs (template exists in CONTRIBUTING).
- `API-09` put thresholds (`p95 ≤ 500 ms`, `non-2xx ≤ 1 %`) on `loadtest.mjs` and gate a soak
  profile in CI on the PG job — everything measured is already scripted in `qa-evidence/load10k`.
- `QAT-02` enforce real coverage floors (remove the live-file exclusion the audit flagged).
- `ARC-08`/`API-08` evidence a scheduler/cron execution (the scripts exist; run one with a receipt).

**Group B — real but bounded feature work**
- `ARC-09` shared resilience wrapper (timeout, bounded retry + jitter, circuit breaker) behind
  weather/AI/SMS/S3 — client-side jitter already exists; the server wrapper is the missing half.
- `ARC-11`/`SEC-03` generated route × role matrix (85 routes) with a freshness guard test.
- `API-01` endpoint-level route inventory; `API-02` add `Idempotency-Key` as a header alongside
  the body field.
- `API-04` property-based money tests (fast-check) — the audit found real bugs with these.
- `API-05` cursor pagination on growing lists; unbounded nested-list caps.
- `ARC-03` DB CHECK constraints + invariant register.
- `SEC-06` purge-failure retry honesty; reconcile the two policy copies.
- `SEC-12` failed-login/payment-intent audit events + a ZAP/DAST baseline job.
- `QAT-05` e2e against the production build (the harness already does this locally).
- `QAT-09` axe per state, remove the active AA contrast debt.
- `WEB` family: CWV/Lighthouse budget gate, offline TTL decision, hex-token lint, deep links,
  monochrome icon, per-screen heuristics evidence.
- `DOC-04`/`ARC-20` ADRs 0012–0016 (RLS decision, hosting, payment provider, contract strategy).
- `ARC-17` offline-queue TTL + auth-change hazard test.
- `SLP` family: knip + jscpd gates, type-aware lint rules, 5 oversized files split, dead exports.

**Group C — thorny, multi-day (still no owner dependency)**
- `ARC-02` import-boundary enforcement on the real graph; `ARC-12` RLS prototype + ADR-0015.
- `ARC-14` traceparent propagation + committed SLOs with error budgets.
- `ARC-16` STRIDE threat model mapped to tests; `API-06`/`SEC-08` agronomy KB sourcing
  **coordination** is owner-bound, the writing is not.
- `OPS-04` measured RPO/RTO from the restore harness; `OPS-08` CI compose-smoke job.

## Owner / human actions (deliberately excluded from the fixable list)

- **Merging PR #40** — review + conflict resolution against `fix/audit-10k-hardening` (both
  branches touch `ci.yml`, limiters, docs); the merge decision itself is owner sign-off.
- Platform secrets/config: `REDIS_URL`, `METRICS_TOKEN`, S3 bucket credentials
  (`AUD-165` is fixable in code but needs a bucket), production `PITR` verification, log sink.
- Domain, Play Console account + signed AAB uploads, live payment credentials.
- Expert agronomist review and KB sourcing sign-off (`API-10`/`SEC-08`/`PRD-04` are 0-capable).
- Legal/counsel conclusions on consent and policies (`PRD-05`).
- P4 UAT completion; screen-reader and device passes (native Bangla review) — human testing.
- External observability sink (alerts/logs) — vendor account.

## Reproduction

```
python docs/qa/score-current.py                 # the rating, from committed artifacts
python .audit/v2/score-v2.py                    # the unmerged branch's 63.13 (local artifact)
gh pr view 40 --json state,mergedAt             # the controlling fact
npm run typecheck && npm run test --workspace apps/api   # 373/373 on PG17 (see docs/testing.md)
```

### Third pass (same day, CI/CD + live deployment)

All remaining terminology/protocol rows landed: TODO gate + ERD freshness + route-matrix
`--check` added to the CI quality job (CID-06/documented partial), route matrix mount-prefix
documentation, CONTRIBUTING code conventions (SLP-05), traceability (QAT-01), STRIDE and
SLOs/runtime-contract pages (ARC-16/OPS-01/ARC-06 partials — docs).

Live pipeline + deploy, executed per repo SOP:
1. Branch `fix/audit-10k-hardening` pushed → PR #49 → full CI 13/13 green (CodeQL alert fix
   included: the two PR-new alerts were in this branch's own new scripts and were fixed).
2. Squash-merged → main `98447ee` → the first main CI run failed on
   `footer-max-line-length` (GitHub's squash-generated footer) → PR #51 disabled the rule for
   machine-generated footers → merged → the main CI run then passed ALL jobs.
3. Production deploys via Vercel Git integration (both projects) completed; the API was also
   CLI-deployed from the local tree (`vercel --prod`), after which the git-integration build
   took over the alias.
4. Live verification on the production URL: `/health.commit` = `2e37cd9` (== current main
   tip, full sync), `/ready` db:true + schema chain latest, `X-Trace-Id` echo live,
   `Invalid-idempotency-key` guard live, membership plans public 200, register → login →
   products → cart → checkout (order ORD-20261021-8EC14E4F CONFIRMED) and an idempotent
   REPLAY proving the same order twice — all executed against the production database.

Final V2-catalog score on this state: **40.32** (docs/qa/score-current.py). The remaining gap
to the 63.13 remediation branch and beyond stays as documented: PR #40 merge decision plus
the owner/human-bound rows (Agronomy KB sourcing, UAT, legal, device passes, production
infra).
