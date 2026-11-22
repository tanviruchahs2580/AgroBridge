# Restore drill receipt — TEMPLATE

Copy this file to `qa-evidence/receipts/<date>-restore-drill.md` and fill every bracket. A receipt
with brackets left in is an unsigned receipt — the gate (G4) needs the owner's signature on real
numbers, which only a real run (and, for the production shape, a Neon PITR branch drill) can
produce.

- Machine / network: [where the drill ran; for the remote drill, the Neon region]
- Operator: [name]
- Source of the dump: [local compose db @ commit <sha> | Neon PITR branch restored to <timestamp>]
- Scratch target: [host only — no credentials] + the SCRATCH_HOST_ALLOW value used
- Commit under test: [git sha]

## Timed phases (from the script's receipt section)

| Phase | Duration |
|---|---|
| Dump (export) | [ms] |
| Restore (schema + data) | [ms] |
| Row-count verification | [ms] |
| Smoke queries | [ms] |
| **Total rehearsal** | **[ms]** |

## Verdict

- Row integrity: [100% / mismatches listed]
- Orphan spot-check (FarmEvent→Farm): [0 orphans / count]
- Smoke queries: [all returned / failing query]

## Owner signature

- RPO signed: [value] — accepted by [owner], [date]
- RTO signed: [value] (data layer measured above; cutover path: [describe]) — accepted by [owner], [date]

## Known limitations of this drill (copy into every receipt)

- Application-level logical rehearsal; the production restore path is Neon PITR + fresh branch.
- Does not rehearse deploy cutover, secret rotation, or restore under incident load.
- Dump file deleted after verification; no database dump is ever committed.
