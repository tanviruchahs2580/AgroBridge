# Traceability — retired (2026-11-10)

This page (QAT-01) duplicated `docs/qa/test-traceability.md` — two competing capability→test maps
with different shapes. It had **no inbound references anywhere** in the repository
(`grep -rn "docs/traceability"` → 0 results before retirement) while `docs/STATUS.md` §Where the
evidence lives pointed only at the other, and neither carried requirement IDs. Two traceability
documents is a drift generator, so this one is retired in favour of the live map:

**→ [docs/qa/test-traceability.md](qa/test-traceability.md)**

Kept as a redirect rather than deleted so a reader arriving from an old link lands on the
maintained page (F-56 in `docs/audit/2026-11-10-full-qa-audit.md`).

The retired table's one recorded positive: **all 48 suite names it listed resolved to real files**
(verified when it was retired). The live map's representative-test column is the maintained one,
and it tracks the 2026-11-10 domain-named suite renames (F-92): the round-numbered files
(`hardening-round11`, `misc-hardening`, `round10-regressions`, `rbac-fixes`, `auth-hardening`,
`disease-upload-hardening`) were split into behaviour-named suites.
