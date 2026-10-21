#!/usr/bin/env python3
"""Current-condition score on the V2 audit catalog — 2026-10-21 re-audit.

Reproduces the V2 audit's scoring (the owner's master-prompt parameter set:
113 parameters, 10 weighted categories, 0-4 points each, capped by evidence level)
against the CURRENT tree, which is `main @ 0ce54b5` (the audit's own G0 baseline)
plus the 10k-concurrency hardening commits on `fix/audit-10k-hardening`.

BASE_SCORES is copied verbatim from the V2 audit's wave-0 config
(`.audit/v2/score.py` — a local, git-excluded audit artifact), so this file is
reproducible from the committed repository alone. Every DELTA below names the
commit/artifact that justifies it. Parameters with no new evidence keep their
wave-0 value.

Reproduce:  python docs/qa/score-current.py
"""
from pathlib import Path

WEIGHTS = {"ARC": 20, "SEC": 12, "API": 12, "SLP": 10, "QAT": 10, "CID": 8,
           "OPS": 8, "WEB": 8, "DOC": 6, "PRD": 6}

# Wave-0 values (verbatim from .audit/v2/score.py), credited to the tree the audit
# scored. `None` here means "category set defined below is complete for this param".
# Wave-0 values (verbatim from .audit/v2/score.py — the V2 catalog's own
# assessment of `main @ 0ce54b5`, the tree this branch hardened).
BASE_SCORES = {
    # ARC (20)
    "ARC-01": (0, "no C4/sequence diagrams, no Mermaid anywhere"),
    "ARC-02": (1, "no boundary lint; cross-module imports; 152 prisma calls in route files"),
    "ARC-03": (2, "conditional-update guards + PG concurrency tests; no CHECKs/register"),
    "ARC-04": (1, "3 schema copies, 2 chains; models-only parity test; post-merge drift gate"),
    "ARC-05": (2, "chain applies on fresh PG in CI; idempotent script; no rollback/cc notes"),
    "ARC-06": (0, "no maxDuration/regions/pool contract; capacity explicitly disclaimed"),
    "ARC-07": (1, "in-memory maps/limiters; prod uploads on local disk (AUD-165)"),
    "ARC-08": (2, "ADR-0010 records no-queue decision; cron scripts documented"),
    "ARC-09": (1, "per-adapter timeouts only; no shared policy/circuit breaker/failure-injection"),
    "ARC-10": (1, "no OpenAPI; base-path docs parity test only; no Idempotency-Key header"),
    "ARC-11": (1, "6-case security matrix; no generated route x role matrix; no step-up decision"),
    "ARC-12": (2, "app-level scoping + cross-tenant negative tests; no RLS decision record"),
    "ARC-13": (2, "zod env schema + prod fail-fast + parity test; some direct env reads"),
    "ARC-14": (1, "request-id + metrics + alert rules as code; no tracing/SLO/external sink"),
    "ARC-15": (2, "web byte budgets CI-enforced; load doc; no EXPLAIN/N+1 evidence"),
    "ARC-16": (0, "no STRIDE/threat model"),
    "ARC-17": (2, "queue + ADR-0009 + unit tests; auth-change hazard (AUD-139); no TTL"),
    "ARC-18": (1, "deploy gate verifies code+schema (E3); no promotion path/rollback rehearsal"),
    "ARC-19": (1, "compose exists w/ healthchecks; not smoke-tested in CI; monitoring unwired"),
    "ARC-20": (2, "11 ADRs statused+indexed; missing hosting/RLS/payment-provider; 3 contradictions"),
    # SEC (12)
    "SEC-01": (3, "gitleaks CI at SHA (E3); no tracked secrets; FPs registered; full-history scan E1"),
    "SEC-02": (2, "rotation+reuse detection+OTP+timing; no recovery (AUD-143)/per-account throttle (AUD-142)"),
    "SEC-03": (2, "negative suites + deny-by-default; matrix not generated/100%"),
    "SEC-04": (3, "zod on mutating routes; upload hardening; SSRF/XSS sinks audited; abuse tests in CI"),
    "SEC-05": (3, "hash-pinned CSP + full header set verified live (E4); parity gate in CI"),
    "SEC-06": (2, "export/deletion tested; purge-failure honesty gap; policy copies diverge (AUD-150)"),
    "SEC-07": (2, "audit blocking (prod tree) + SBOM + overrides registered; mutable base images (AUD-152)"),
    "SEC-08": (2, "51-case injection suite + frozen eval + budget breaker; KB UNSOURCED (AUD-127)"),
    "SEC-09": (3, "server-side amounts; webhook sig+amount+claim; race tests in CI; live flag human-gated"),
    "SEC-10": (2, "manifest/NSC/webdebug hardened; apksigner gate; device behaviour unverified"),
    "SEC-11": (2, "per-route limiters documented+tested; prod store memory (AUD-140); upload no limiter"),
    "SEC-12": (1, "18 audit actions; no DAST (AUD-153); no failed-login/payment-intent audit events"),
    # API (11)
    "API-01": (2, "docs-route parity (base paths) in CI; no endpoint-level inventory; 1 unused route"),
    "API-02": (3, "uniform envelope + codes + prod error hygiene; envelope tests in CI"),
    "API-03": (2, "14 transactions; ledger append-only; reconciliation script unrun by any test"),
    "API-04": (2, "PG concurrency/race suites in CI; no property-based tests; rating race sequential"),
    "API-05": (1, "indexes + pagination caps; no EXPLAIN/N+1 evidence; unbounded nested lists"),
    "API-06": (1, "seed gated; production bootstrap used ALLOW_DEMO_SEED=1 once (rotation unverifiable)"),
    "API-07": (2, "AI/weather/payment failure-injection tests; S3/notification adapters untested for failure"),
    "API-08": (2, "ADR-0010 + idempotent client-uuid/claims; no scheduler execution evidence"),
    "API-09": (1, "local 10s autocannon, no thresholds/soak/PostgreSQL (AUD-133 blocked)"),
    "API-10": (0, "no sourced agronomy rule anywhere; KB all UNSOURCED; review sheet pending"),
    "API-11": (2, "bilingual + dedup tested; preferences inert (AUD-141)"),
    # SLP (14)
    "SLP-01": (1, "recommended lint only; no type-aware rules; 144 req.auth!; suppressions partly bare"),
    "SLP-02": (1, "no knip/jscpd/depcheck; dead lib/errors.ts; 7 re-export shims"),
    "SLP-03": (1, "5 files >600 lines; no size/complexity rules"),
    "SLP-04": (1, "140 rule/audit refs in source; 38 narrative comments; TODO/comment-out clean"),
    "SLP-05": (1, "API module layout consistent; web lib naming mixed; conventions undocumented"),
    "SLP-06": (2, "no fabricated UI content; seed gated; 1 positioned tagline needs sign-off"),
    "SLP-07": (2, "env/route/action-pin verifiers exist; version-string drift in app.ts/package-lock"),
    "SLP-08": (1, "dead exports (health.ts), unused /organizations, dual-dialect duplication"),
    "SLP-09": (2, "no swallowed errors in src (justified catches); console.* 5 sites; script catches bare"),
    "SLP-10": (2, "0 .only/.skip except 1 justified PG gate; assertions real; exclusions need cleanup"),
    "SLP-11": (2, "Conventional Commits 40/40; root diaries/superlative + certification wording remain"),
    "SLP-12": (1, "root diaries + docs/generated clutter; 33 reports outside archive"),
    "SLP-13": (2, "overrides documented; postinstall idempotent; dead allowScripts; lockfile version stale"),
    "SLP-14": (2, "bn/en parity in CI; no glossary; native review pending (AUD-129)"),
    # QAT (12)
    "QAT-01": (1, "counts by level; no requirement->test matrix (no P0/P1 register)"),
    "QAT-02": (1, "floors enforced in CI; live-file exclusion + stale path + near-vacuous web floors (AUD-148)"),
    "QAT-03": (2, "1 justified skip; assertions dense; no mutation testing; no 10x repeat probe"),
    "QAT-04": (3, "full suite on fresh PG from shipping chain, in CI at SHA (E3)"),
    "QAT-05": (1, "e2e on dev server; chromium-only; no prod build / device pass (AUD-147)"),
    "QAT-06": (3, "response-contract drift guard in CI; explicit regeneration flag"),
    "QAT-07": (0, "no load/soak/spike thresholds; no connection-exhaustion drill"),
    "QAT-08": (2, "security matrix + 51-case injection + upload abuse; no DAST (AUD-153)"),
    "QAT-09": (2, "axe critical/serious in CI; 2 exclusions (1 active AA debt AUD-161); not per state"),
    "QAT-10": (2, "key parity + inline-ternary ratchet in CI; no pseudo-locale/flow snapshots"),
    "QAT-11": (0, "no visual baselines; chromatic undeliverable (AUD-155)"),
    "QAT-12": (0, "no exploratory charters / committed defect->regression map"),
    # CID (10)
    "CID-01": (1, "purpose comments mostly; 2 never-runnable workflows; develop trigger; no name on android-release"),
    "CID-02": (2, "ruleset: 11 required contexts, no bypass, linear history, thread resolution; IaC not required (AUD-144); 0 approvals documented"),
    "CID-03": (2, "contents:read everywhere; no pull_request_target; no OIDC; long-lived staging/keystore secrets"),
    "CID-04": (2, "16/16 action pins resolve upstream; base images mutable; Dependabot lacks docker"),
    "CID-05": (2, "npm ci + cache + concurrency + timeouts; PR gate ~5.4 min; Node not single-sourced; no docker layer cache"),
    "CID-06": (2, "broad blocking set in CI (E3); missing: pre-merge migration, licence, Lighthouse, diff-coverage"),
    "CID-07": (1, "post-merge code+schema verification (E3); no promotion chain; no rollback rehearsal (AUD-154)"),
    "CID-08": (2, "signing guards + apksigner CN check; AAB check weak (AUD-146); versionCode manual"),
    "CID-09": (2, "failure artifacts uploaded; no flake register; truthful (no badges)"),
    "CID-10": (2, "PR template, labels, gitattributes, version check; no issue templates/commitlint/dependabot groups"),
    # OPS (9)
    "OPS-01": (0, "no SLIs/SLOs/error budgets anywhere"),
    "OPS-02": (1, "6 alert rules + dashboard as code; 1/6 runbook links; no sink/probe; doc drift"),
    "OPS-03": (2, "pino redaction tests + request-id; retention/volume unset; no tracing"),
    "OPS-04": (1, "restore harness exists (output reproduced); PITR unverified; no measured RPO/RTO vs targets"),
    "OPS-05": (1, "local load profile, no capacity claims; platform limits undocumented; API runs iad1 (AUD-163)"),
    "OPS-06": (1, "6 runbooks; no dry-run receipts; postmortem template missing"),
    "OPS-07": (1, "rotation runbook; no drill; single DB role (app can DDL)"),
    "OPS-08": (1, "compose w/ healthchecks; monitoring not wired; no CI compose smoke"),
    "OPS-09": (1, "web budgets enforced; no API/3G bytes table"),
    # WEB (10)
    "WEB-01": (2, "byte budgets in CI (entry 142.4/150 kB gz); no CWV/Lighthouse gate; budget above 130 kB proposal"),
    "WEB-02": (2, "loading/empty/error/stale per screen; offline = banner only; forbidden only in Admin"),
    "WEB-03": (2, "axe in CI; active contrast exclusion (AUD-161); no manual SR/zoom pass"),
    "WEB-04": (2, "parity + ternaries + Intl in CI; unused-key warn-only; no glossary; sign-off pending"),
    "WEB-05": (1, "queue ADRs+tests; auth-change hazard (AUD-139); no TTL; no offline reads"),
    "WEB-06": (2, "CSP verified live + preflight; XSS sinks clean; localStorage tokens = accepted risk (OD-02)"),
    "WEB-07": (1, "chromium-only; no Firefox/WebKit/emulator (AUD-147)"),
    "WEB-08": (1, "tokens mostly single-source; raw hex leaks; no hex lint; no visual baselines"),
    "WEB-09": (1, "confirmations+terminology good; no task timing / per-screen heuristics evidence"),
    "WEB-10": (1, "hardened config + version single-source; no emulator smoke; no deep links; monochrome missing"),
    # DOC (9)
    "DOC-01": (2, "quick start resolves; counts stale (AUD-157)"),
    "DOC-02": (1, "links clean; no owner/last-verified SHA; no docs-claims verifier in CI"),
    "DOC-03": (2, "single version source + CI check; changelog format good; released changes partly in [Unreleased]"),
    "DOC-04": (2, "11 ADRs indexed; missing hosting/RLS/payment decisions; naming mixed"),
    "DOC-05": (1, "runbooks present; none executed with receipts"),
    "DOC-06": (2, "CONTRIBUTING honest, SECURITY SLA, PR template; no CoC/issue templates; stale counts"),
    "DOC-07": (0, "no OpenAPI/ERD generation; env reference hand-written (parity-guarded)"),
    "DOC-08": (0, "root diaries + certification wording; no STATUS page; docs/generated not archived (AUD-160)"),
    "DOC-09": (0, "no asset provenance table; unknown-rights images (AUD-151)"),
    # PRD (6)
    "PRD-01": (2, "spot-checked feature claims hold; run-result numbers not reproduced"),
    "PRD-02": (1, "per-env config + owner-gated activation; no replay window/reconciliation/refunds (OD-07)"),
    "PRD-03": (2, "rules in code+tests; no product business-rules document"),
    "PRD-04": (1, "UNSOURCED ledger + labels + escalation; no expert sign-off (AUD-127/128)"),
    "PRD-05": (0, "no consent capture; divergent policy copies; legal review pending (AUD-150)"),
    "PRD-06": (1, "play docs prepared; current-official-docs check pending; keystore/FCM owner gates"),
}

# Deltas applied by the 2026-10-21 audit-remediation branch (ed6fd3e..913839d and the second pass).
# Each names the artifact that justifies it. Rejected candidates are listed in
# REJECTED below and carry no score.
DELTAS = {
    # Pool/instance contract now exists as configuration with measured guidance, and
    # capacity carries a measured 10k table instead of a blanket disclaimer
    # (docs/performance.md "10 000 concurrent users", docs/operations.md, env keys
    # MAX_CONCURRENT_REQUESTS / DATABASE_CONNECTION_LIMIT / SERVER_MAX_CONNECTIONS /
    # BCRYPT_POOL_SIZE). Still no maxDuration/region contract, so 1 (partial), not 2.
    "ARC-06": (1, "pool/instance knobs + measured 10k table + tuning guidance (docs/operations.md, docs/performance.md); maxDuration/region contract still absent"),
    # The 2026-10-21 round ran the drill the parameter asks for: a 10 000-session
    # simulation plus overload bursts with DB-pool sampling (results in
    # qa-evidence, numbers committed in docs/performance.md and the 10k report).
    # Ad-hoc and unautomated — 1, not 2.
    "QAT-07": (1, "10k-session simulation + overload/connection-pressure drills executed and reported (docs/qa/2026-10-21-load-10k-and-condition-report.md); no automated soak/threshold in CI"),
}

# The wave-0 audit deducted one point per false/unverifiable claim left in docs.
# All five were re-verified against the current tree on 2026-10-21 and fixed in the
# branch being scored (8155089/913839d plus the doc fixes in this round):
RESOLVED_CLAIMS = [
    "CONTRIBUTING.md:99-100 test counts 150/108 → de-claimed with a pointer",
    "docs/deployment.md:11 Node >= 20 → Node >= 22 (engines floor)",
    "docs/operations.md:14 '/metrics (no auth…)' → states the production guard",
    "docs/performance.md vs docs/testing.md hashing inconsistency → testing row marked superseded, performance carries the measured before/after",
    "README.md web unit count 159 → 166 (measured 2026-10-21), counts de-claimed",
]

OPEN_S1 = ["AUD-165"]
OPEN_S2 = ["AUD-127", "AUD-128", "AUD-129", "AUD-131", "AUD-132", "AUD-133",
           "AUD-139", "AUD-141", "AUD-164"]
UAT_COMPLETE = False


def main() -> None:
    scores = dict(BASE_SCORES)
    for k, (s, why) in DELTAS.items():
        scores[k] = (s, why)

    cats = {}
    for k, (s, why) in scores.items():
        cats.setdefault(k.split("-")[0], []).append(s)

    total = 0.0
    print("| Domain | Score | Max | Points | Count |")
    print("|---|---:|---:|---:|---:|")
    for cat in WEIGHTS:
        ids = cats.get(cat, [])
        ssum = sum(ids)
        pts = ssum / (4 * len(ids)) * WEIGHTS[cat]
        total += pts
        print(f"| {cat} | {ssum} | {4 * len(ids)} | {pts:.2f} | {len(ids)} params |")
    print(f"| **Total (uncapped)** | | | **{total:.2f}** | |")

    penalty = 0  # all five wave-0 doc claims resolved — list above in RESOLVED_CLAIMS
    score = total - penalty
    caps = []
    if OPEN_S1:
        caps.append(("open S1 (AUD-165) -> <= 55", 55))
    if OPEN_S2:
        caps.append(("open S2 without signed waiver -> <= 70", 70))
    if not UAT_COMPLETE:
        caps.append(("P4 UAT incomplete -> <= 75", 75))
    for name, cap in caps:
        score = min(score, cap)

    print(f"- Wave-0 doc-claim penalty: all 5 resolved on this tree -> -0")
    print(f"- Caps considered (none bind at this level): {', '.join(n for n, _ in caps)}")
    print(f"- **Score after penalties/caps: {score:.2f} / 100**")
    band = ("90-100 enterprise-grade" if score >= 90 else
            "80-89 production-grade, minor gaps" if score >= 80 else
            "70-79 production-capable, notable gaps" if score >= 70 else
            "60-69 strong pilot-grade" if score >= 60 else
            "below 60: prototype / at risk by the V2 catalog's own scale")
    print(f"- Band per V2 §10 scale: {band}")
    print()
    print(f"Reference points: wave-0 (this catalog's own verdict on the inherited tree,")
    print(f"uncapped) 37.22 / 32.22 after penalties; the remediation wave W1+W2 scored")
    print(f"45.70 → 63.13 on branch audit/v2-remediation — merged nowhere (PR #40 open).")


if __name__ == "__main__":
    main()
