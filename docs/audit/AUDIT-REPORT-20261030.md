# AgroBridge audit — public report

Verdict: **INCOMPLETE — FAIL** (computed by the audit tooling, not declared by the auditor).
Baseline `b8ae2b0` → tested `a5f29a8`. Achieved score: **95.07 / 100** (baseline 57.51). Confidence
LOW (73.3 % execution-backed; the tool reserves HIGH for >=95 %). Band: n/a under an INCOMPLETE verdict.

## What ran

A standard-profile audit: full source and runtime reconnaissance; secret scans of the working tree
and the entire Git history (clean); production boot-refusal probes; both test suites on SQLite and
PostgreSQL 17; web typecheck/lint/i18n/unit/build; a container build and compose smoke; a
documented fresh-clone setup; a user-simulation pass on the pushed SHA from a clean clone
(51/52 browser tests locally, CI browser suite green, plus a dedicated acceptance spec for the
disease-photo workflow); an independent adversarial review in a fresh context; and a pushed
draft pull request whose required CI checks all pass (PR #88).

## What was fixed (by class)

- A core workflow that stored crop-disease photos but had no way to serve them back — the advertised
  expert-review loop could not practically complete. A read path now exists with strict owner /
  reviewer access rules, and the farmer can view their own photo again.
- Two storage-adapter defects found by the independent review inside that new path (key resolution
  under a configured storage directory; an unimplemented object-store read), each with new
  regression tests.
- Coverage-gate honesty: exercised provider adapters are instrumented again, with the thresholds
  unchanged and still met; remaining exclusions are limited to type-only modules.
- Web-side hardening of the new viewer (stale-response and object-URL handling), audit logging for
  reviewer access to farmer photos, and documentation parity for the new endpoint.

All eight fixes carry commits, regression tests and evidence in the private report.

## Open items with the owner

Two environment-governance and credential-hygiene items and one local cleanup item are recorded as
owner actions in the private report; none is a code defect and no open item meets the audit's
critical or high severity threshold. No live credential exists in the repository or its history.

## Why the verdict is INCOMPLETE

- The mandatory user-simulation set was not exhausted: three scenarios passed end-to-end; the
  remaining archetypes (registration flows, shop filters/receipts, procurement/wallet/payment
  matrices, restart and restore drills, throttled-device performance) were not reached this run.
- Live AI and weather provider behaviour is unverified because no test-grade credentials were
  supplied; deterministic replay covers the contract paths only.
- The medium/low tier of the audit catalog and the cold-read protocol remain partially unexecuted.

## What this report does not claim

No legal, agronomic or native-language certification; no claim that every risk is gone. Expert
reviews for agronomy and Bangla copy are queued for the owner, and the repository's own go-live
checklist remains the release gate. The full finding register, evidence records and remediation
detail live in the private audit report delivered to the owner; the sanitized summary here follows
the disclosure-hygiene rules, so fixed items are described by class only.


---

## Revision: final acceptance (tested a5f29a8)

- **All 51 mandatory scenarios PASS** on a fresh clone (44 through the UI specs, 5 drills, 2 carried
  over), plus the throttled-performance drill on the production build.
- Score **95.07 / 100**. Gates: every gate PASS except **GATE-07**, which fails on one owner action —
  the native-speaker review of the Bangla copy (G-03); the reviewer sheet is prepared.
- The only cap is **CAP-08**: live provider legs are blocked without credentials — the hosted AI
  model against a real endpoint, live weather response shapes, and the national banned/restricted
  pesticide list (DAE/PPW unreachable from this environment) are recorded **UNVERIFIED**, not claimed.
- Everything shown as fixed has a commit, an executed test and an evidence file; nothing blocked is
  described as fixed.
