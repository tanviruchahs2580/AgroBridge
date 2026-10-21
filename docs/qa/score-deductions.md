# Score deductions after W1 (45.70/100) — every parameter below 3, and what closes it

Copied from the W1 scoring snapshot (2026-10-19) and updated after the documentation wave of the
same date: rows whose residual item moved are marked **⟨wave⟩** and explained in
[Wave status](#wave-status-2026-10-19) at the end. The point columns and the total are the W1
assessment; documentation-only work does not change a parameter score, so the totals stand.

A parameter reaches 3 when its §6 pass criteria are met AND an automated gate keeps them met;
4 additionally needs drills/monitoring. Points at stake per category are the W1 category maxima.

| Category | Param | Now | Status | What is still missing |
|---|---|---:|---|---|
| ARC | ARC-01 | 2 | criteria substantially met | C4 + sequence diagrams committed (Mermaid), captioned to source; doc claims corrected |
| ARC | ARC-02 | 1 | partial, no automation | no boundary lint; cross-module imports; 152 prisma calls in route files |
| ARC | ARC-03 | 2 | criteria substantially met | conditional-update guards + PG concurrency tests; no CHECKs/register |
| ARC | ARC-04 | 2 | criteria substantially met | pre-merge drift job added (chain vs shipping schema); parity guard; PG-only plan still owner-gated |
| ARC | ARC-05 | 2 | criteria substantially met | chain applies on fresh PG in CI; idempotent script; no rollback/cc notes |
| ARC | ARC-06 | 2 | criteria substantially met | runtime contract documented with published platform limits + observed region/timeouts (pool sizing owner-side) |
| ARC | ARC-07 | 1 | partial, no automation | in-memory maps/limiters; prod uploads on local disk (AUD-165) |
| ARC | ARC-08 | 2 | criteria substantially met | ADR-0010 records no-queue decision; cron scripts documented |
| ARC | ARC-09 | 1 | partial, no automation | per-adapter timeouts only; no shared policy/circuit breaker/failure-injection |
| ARC | ARC-10 | 1 | partial, no automation | no OpenAPI; base-path docs parity test only; no Idempotency-Key header |
| ARC | ARC-11 | 1 | partial, no automation | 6-case security matrix; no generated route x role matrix; no step-up decision **⟨wave⟩** |
| ARC | ARC-12 | 2 | criteria substantially met | app-level scoping + cross-tenant negative tests; no RLS decision record **⟨wave⟩** |
| ARC | ARC-13 | 2 | criteria substantially met | zod env schema + prod fail-fast + parity test; some direct env reads |
| ARC | ARC-14 | 2 | criteria substantially met | SLOs proposed + alert-to-SLO/runbook map; no tracing/sink yet |
| ARC | ARC-15 | 2 | criteria substantially met | web byte budgets CI-enforced; load doc; no EXPLAIN/N+1 evidence |
| ARC | ARC-16 | 2 | criteria substantially met | STRIDE threat model committed; abuse cases mapped to tests (5 without a dedicated test, flagged) |
| ARC | ARC-17 | 2 | criteria substantially met | queue + ADR-0009 + unit tests; auth-change hazard (AUD-139); no TTL |
| ARC | ARC-18 | 1 | partial, no automation | deploy gate verifies code+schema (E3); no promotion path/rollback rehearsal |
| ARC | ARC-19 | 1 | partial, no automation | compose exists w/ healthchecks; not smoke-tested in CI; monitoring unwired |
| ARC | ARC-20 | 2 | criteria substantially met | 11 ADRs statused+indexed; missing hosting/RLS/payment-provider; 3 contradictions **⟨wave⟩** |
| SEC | SEC-03 | 2 | criteria substantially met | negative suites + deny-by-default; matrix not generated/100% |
| SEC | SEC-06 | 2 | criteria substantially met | export/deletion tested; purge-failure honesty gap; policy copies diverge (AUD-150) **⟨wave⟩** |
| SEC | SEC-07 | 2 | criteria substantially met | audit blocking (prod tree) + SBOM + overrides registered; mutable base images (AUD-152) |
| SEC | SEC-10 | 2 | criteria substantially met | manifest/NSC/webdebug hardened; apksigner gate; device behaviour unverified |
| SEC | SEC-11 | 2 | criteria substantially met | per-route limiters documented+tested; prod store memory (AUD-140); upload no limiter |
| SEC | SEC-12 | 2 | criteria substantially met | audit events extended (reset/throttle paths), alerts as code + runbook links; DAST still absent **⟨wave⟩** |
| API | API-01 | 2 | criteria substantially met | docs-route parity (base paths) in CI; no endpoint-level inventory; 1 unused route |
| API | API-03 | 2 | criteria substantially met | 14 transactions; ledger append-only; reconciliation script unrun by any test |
| API | API-04 | 2 | criteria substantially met | PG concurrency/race suites in CI; no property-based tests; rating race sequential |
| API | API-05 | 1 | partial, no automation | indexes + pagination caps; no EXPLAIN/N+1 evidence; unbounded nested lists |
| API | API-06 | 1 | partial, no automation | seed gated; production bootstrap used ALLOW_DEMO_SEED=1 once (rotation unverifiable) |
| API | API-07 | 2 | criteria substantially met | AI/weather/payment failure-injection tests; S3/notification adapters untested for failure |
| API | API-08 | 2 | criteria substantially met | ADR-0010 + idempotent client-uuid/claims; no scheduler execution evidence |
| API | API-09 | 1 | partial, no automation | local 10s autocannon, no thresholds/soak/PostgreSQL (AUD-133 blocked) |
| API | API-10 | 0 | absent/failing | no sourced agronomy rule anywhere; KB all UNSOURCED; review sheet pending |
| SLP | SLP-01 | 1 | partial, no automation | recommended lint only; no type-aware rules; 144 req.auth!; suppressions partly bare |
| SLP | SLP-02 | 1 | partial, no automation | no knip/jscpd/depcheck; dead lib/errors.ts; 7 re-export shims |
| SLP | SLP-03 | 1 | partial, no automation | 5 files >600 lines; no size/complexity rules |
| SLP | SLP-04 | 2 | criteria substantially met | audit/phase refs removed from shipped source (tests keep regression refs by policy) |
| SLP | SLP-05 | 1 | partial, no automation | API module layout consistent; web lib naming mixed; conventions undocumented |
| SLP | SLP-06 | 2 | criteria substantially met | no fabricated UI content; seed gated; 1 positioned tagline needs sign-off |
| SLP | SLP-07 | 2 | criteria substantially met | env/route/action-pin verifiers exist; version-string drift in app.ts/package-lock |
| SLP | SLP-08 | 1 | partial, no automation | dead exports (health.ts), unused /organizations, dual-dialect duplication |
| SLP | SLP-09 | 2 | criteria substantially met | no swallowed errors in src (justified catches); console.* 5 sites; script catches bare |
| SLP | SLP-10 | 2 | criteria substantially met | 0 .only/.skip except 1 justified PG gate; assertions real; exclusions need cleanup |
| SLP | SLP-13 | 2 | criteria substantially met | overrides documented; postinstall idempotent; dead allowScripts; lockfile version stale |
| SLP | SLP-14 | 2 | criteria substantially met | bn/en parity in CI; no glossary; native review pending (AUD-129) |
| QAT | QAT-01 | 1 | partial, no automation | counts by level; no requirement->test matrix (no P0/P1 register) |
| QAT | QAT-02 | 2 | criteria substantially met | live-file/stale exclusions removed, web floors raised to measured-2; diff-coverage still absent |
| QAT | QAT-03 | 2 | criteria substantially met | 1 justified skip; assertions dense; no mutation testing; no 10x repeat probe |
| QAT | QAT-05 | 2 | criteria substantially met | production-build e2e pass + cross-engine smoke added; device pass still none |
| QAT | QAT-07 | 0 | absent/failing | no load/soak/spike thresholds; no connection-exhaustion drill |
| QAT | QAT-08 | 2 | criteria substantially met | security matrix + 51-case injection + upload abuse; no DAST (AUD-153) **⟨wave⟩** |
| QAT | QAT-10 | 2 | criteria substantially met | key parity + inline-ternary ratchet in CI; no pseudo-locale/flow snapshots |
| QAT | QAT-11 | 0 | absent/failing | no visual baselines; chromatic undeliverable (AUD-155) |
| QAT | QAT-12 | 2 | criteria substantially met | charters committed; defect-to-regression map kept in the findings register |
| CID | CID-02 | 2 | criteria substantially met | ruleset: 11 required contexts, no bypass, linear history, thread resolution; IaC not required (AUD-144); 0 approvals documented |
| CID | CID-03 | 2 | criteria substantially met | contents:read everywhere; no pull_request_target; no OIDC; long-lived staging/keystore secrets |
| CID | CID-04 | 2 | criteria substantially met | 16/16 action pins resolve upstream; base images mutable; Dependabot lacks docker |
| CID | CID-05 | 2 | criteria substantially met | npm ci + cache + concurrency + timeouts; PR gate ~5.4 min; Node not single-sourced; no docker layer cache |
| CID | CID-06 | 2 | criteria substantially met | broad blocking set in CI (E3); missing: pre-merge migration, licence, Lighthouse, diff-coverage |
| CID | CID-07 | 1 | partial, no automation | post-merge code+schema verification (E3); no promotion chain; no rollback rehearsal (AUD-154) **⟨wave⟩** |
| CID | CID-08 | 2 | criteria substantially met | signing guards + apksigner CN check; AAB check weak (AUD-146); versionCode manual |
| CID | CID-09 | 2 | criteria substantially met | failure artifacts uploaded; no flake register; truthful (no badges) |
| CID | CID-10 | 2 | criteria substantially met | PR template, labels, gitattributes, version check; no issue templates/commitlint/dependabot groups |
| OPS | OPS-01 | 0 | absent/failing | no SLIs/SLOs/error budgets anywhere |
| OPS | OPS-02 | 2 | criteria substantially met | every alert now carries a runbook path; external sink/probe still owner-side |
| OPS | OPS-03 | 2 | criteria substantially met | pino redaction tests + request-id; retention/volume unset; no tracing **⟨wave⟩** |
| OPS | OPS-04 | 1 | partial, no automation | restore harness exists (output reproduced); PITR unverified; no measured RPO/RTO vs targets |
| OPS | OPS-05 | 1 | partial, no automation | local load profile, no capacity claims; platform limits undocumented; API runs iad1 (AUD-163) |
| OPS | OPS-06 | 1 | partial, no automation | 6 runbooks; no dry-run receipts; postmortem template missing |
| OPS | OPS-07 | 1 | partial, no automation | rotation runbook; no drill; single DB role (app can DDL) **⟨wave⟩** |
| OPS | OPS-09 | 1 | partial, no automation | web budgets enforced; no API/3G bytes table |
| WEB | WEB-01 | 2 | criteria substantially met | byte budgets in CI (entry 142.4/150 kB gz); no CWV/Lighthouse gate; budget above 130 kB proposal |
| WEB | WEB-02 | 2 | criteria substantially met | loading/empty/error/stale per screen; offline = banner only; forbidden only in Admin |
| WEB | WEB-03 | 2 | criteria substantially met | axe in CI; active contrast exclusion (AUD-161); no manual SR/zoom pass |
| WEB | WEB-04 | 2 | criteria substantially met | parity + ternaries + Intl in CI; unused-key warn-only; no glossary; sign-off pending |
| WEB | WEB-06 | 2 | criteria substantially met | CSP verified live + preflight; XSS sinks clean; localStorage tokens = accepted risk (OD-02) |
| WEB | WEB-07 | 2 | criteria substantially met | firefox/webkit smoke in CI; emulator still none |
| WEB | WEB-08 | 2 | criteria substantially met | raw-hex gate in preflight; visual baselines still absent |
| WEB | WEB-09 | 1 | partial, no automation | confirmations+terminology good; no task timing / per-screen heuristics evidence |
| WEB | WEB-10 | 1 | partial, no automation | hardened config + version single-source; no emulator smoke; no deep links; monochrome missing |
| DOC | DOC-02 | 2 | criteria substantially met | link + claims checks in CI; last-verified banners not yet added |
| DOC | DOC-04 | 2 | criteria substantially met | 11 ADRs indexed; missing hosting/RLS/payment decisions; naming mixed **⟨wave⟩** |
| DOC | DOC-05 | 1 | partial, no automation | runbooks present; none executed with receipts **⟨wave⟩** |
| DOC | DOC-06 | 2 | criteria substantially met | CONTRIBUTING honest, SECURITY SLA, PR template; no CoC/issue templates; stale counts **⟨wave⟩** |
| DOC | DOC-07 | 0 | absent/failing | no OpenAPI/ERD generation; env reference hand-written (parity-guarded) **⟨wave⟩** |
| DOC | DOC-09 | 2 | criteria substantially met | asset provenance inventory committed; unknown-rights assets flagged to owner |
| PRD | PRD-01 | 2 | criteria substantially met | spot-checked feature claims hold; run-result numbers not reproduced |
| PRD | PRD-02 | 2 | criteria substantially met | store-readiness + live-readiness checklists with sources; activation stays owner-only |
| PRD | PRD-03 | 2 | criteria substantially met | rules in code+tests; no product business-rules document |
| PRD | PRD-04 | 1 | partial, no automation | UNSOURCED ledger + labels + escalation; no expert sign-off (AUD-127/128) |
| PRD | PRD-05 | 0 | absent/failing | no consent capture; divergent policy copies; legal review pending (AUD-150) **⟨wave⟩** |
| PRD | PRD-06 | 2 | criteria substantially met | Play requirements re-read from official docs 2026-10-19 and recorded |

Total parameters below 3: 94 of 113.

---

## Wave status (2026-10-19)

Rows marked **⟨wave⟩**, and what actually changed in the documentation wave — each item is
traceable to a file in the repository; nothing else in the table moved.

| Row | Wave change | Where |
|---|---|---|
| ARC-11 | Not fixed. The route x role matrix remains ungenerated in this copy; a generated route/role matrix document is in flight in a parallel workstream and was not committed at this update (docs/adr holds the 13 ADRs listed in the repo, and no generated matrix document exists yet) | `rg` over `docs/` at commit `cbc2f29` |
| ARC-12, ARC-20, DOC-04 | Not fixed. Four ADRs (hosting, RLS, payment-provider decisions among them) are being added by a parallel workstream; not present at this update, so the "missing decisions" deductions stand as written | `ls docs/adr` → 13 files at `cbc2f29` |
| SEC-06, PRD-05 | Partially moved: the policy-copy divergence is now handled at the placeholder level — root `PRIVACY_POLICY.md` / `TERMS_OF_SERVICE.md` carry an owner-action note and point at `apps/web/src/features/legal/content.ts` as the runtime source (Play reads the runtime pages). Consent capture is still absent, now recorded as a verified fact in `docs/legal-compliance-checklist.md`. Legal review remains owner-gated | `PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md`, `apps/web/src/features/legal/content.ts:16-27`, `docs/legal-compliance-checklist.md` |
| SEC-12, QAT-08 | Not fixed. DAST is still absent; the absence and the adjacent controls (SAST via CodeQL, Trivy image/config scans, live-header assertions in the deploy gate) are now stated as code facts in the security document's 2026-10-19 status section | `.github/workflows/codeql.yml`, `.github/workflows/ci.yml:418-541`, `.github/workflows/deploy-verify.yml`, `docs/security.md` |
| CID-07 | Not fixed, now with a written rollback procedure for the operator's half: Vercel instant rollback and Play halt-rollout steps are documented with official sources in the launch checklist | `docs/play/launch-checklist.md` §Order of operations / rollback |
| OPS-03 | Partially moved: retention defaults and the log field/redaction inventory are now documented in `docs/retention-and-logs.md` (log fields + redaction: `apps/api/src/shared/logging/logger.ts:10-42`; DB retention: `docs/data-protection.md`; platform log retention: Vercel Drains, official doc fetched 2026-10-19). The operator configuration itself (sink choice, plan-level retention) is still open | `docs/retention-and-logs.md` |
| OPS-07 | Not fixed. The single-role fact is now recorded in the database document so a least-privilege split is an explicit operator task rather than an unstated gap | `docs/database.md` (roles note) |
| DOC-05 | Partially moved: `qa-evidence/receipts/README.md` now indexes the committed receipts and the log locations. Runbooks are still not executed with dry-run receipts, so the deduction stands | `qa-evidence/receipts/README.md` |
| DOC-06 | Partially moved: `docs/CODE_OF_CONDUCT.md` was added (Contributor Covenant 2.1, adapted contact). Issue templates are still absent and remain the deduction | `docs/CODE_OF_CONDUCT.md` |
| DOC-07 | Not fixed. Generated ERD / env reference / route-role matrix documents are in flight in a parallel workstream; `docs/generated/` was empty at this update | `ls docs/generated` at `cbc2f29` |

Nothing in this wave adds tests or gates, so no parameter moves from 2 to 3 or from 1 to 2 on
documentation alone; the score remains the W1 figure, 45.70/100, and the owner-gated blockers
recorded with that snapshot are unchanged.
