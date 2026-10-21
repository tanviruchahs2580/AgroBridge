# Receipts — committed verification records

A receipt records what was run, where, on which commit, and what came out — so a later reader can
re-run the same commands instead of trusting prose. This directory is the **committed** evidence
store: `.gitignore` keeps `qa-evidence/*` out of the repository except for this directory
(`.gitignore:89-92`). Raw logs, probe scripts and screenshots stay
untracked in `qa-evidence/` (and in operator workspaces); CI run IDs are the durable evidence for
anything CI produces.

## Index

| Receipt | Date | Baseline | What it covers |
|---|---|---|---|
| [2026-10-17-rounds-10-11.md](2026-10-17-rounds-10-11.md) | 2026-10-17 | `e2741f9` (round 10 + review); round-11 figures from `e665b78`/`1a682e6` | Play-launch preparation and live-delivery rounds: API suite 149/1 skip, web unit 108, typecheck/builds, e2e 24/24, functional sweep (local 39/39, production 38 pass / 2 deliberate skips), production dependency audit clean |
| [2026-10-18-live-verification.md](2026-10-18-live-verification.md) | 2026-10-18 | `6282ca8` (both Vercel projects serving it) | Is production running the reviewed source: local gates on the workstation, PostgreSQL 17 suite, production walkthrough of every screen/parameter, and the defect that walkthrough found |
| [2026-10-18-schema-drift-and-release-contract.md](2026-10-18-schema-drift-and-release-contract.md) | 2026-10-18 | `6786a24` | Production schema drift: three migrations unapplied in production while gates stayed green; the fixes and the release-contract check that now compares the applied chain with the repository (ADR-0007) |
| [2026-10-18-web-edge-and-delivery-perf.md](2026-10-18-web-edge-and-delivery-perf.md) | 2026-10-18 | `6897e7b` (after PR #31) | The static site's edge policy (CSP and friends), before/after live header measurements, and the delivery performance numbers with the guard that fails on divergence (ADR-0008) |

## The remediation wave (2026-10-19)

No receipt for the remediation wave is committed in this directory yet as of 2026-10-19. Its
gate results were produced as run logs outside the committed tree, and the durable evidence is
CI: the workflow runs for the branch are the record of what passed, and the code/document state
at the merge commit is what reviewers check against. When a wave receipt is committed here, use
the naming and template below so the set stays uniform.

## Adding a receipt

Conventions used by every file above:

1. **Name:** `YYYY-MM-DD-<topic>.md` (a second receipt on the same day gets a distinct topic).
2. **Header:** why the file exists, the machine/tool versions, and the exact baseline commit.
3. **Body:** a table of gate → command → result, with the actual numbers; deviations and
   re-runs recorded rather than hidden (the existing receipts keep their mid-round failures and
   the reason).
4. **Durability rule:** if CI produced the result, record the run/job ID; if the workstation
   produced it, record the command so it can be reproduced.
5. **Scope rule:** receipts record observations; they do not restate audit findings or make
   forward-looking claims. If a number moves later, add a new receipt — do not edit the old one's
   numbers.

Related, not receipts: `docs/qa/test-traceability.md` (capability → test → CI job map),
`docs/qa/flake-register.md` (non-reproducing failures and their assessment), and
`qa-evidence/` at the top level (untracked working logs and probe scripts).
