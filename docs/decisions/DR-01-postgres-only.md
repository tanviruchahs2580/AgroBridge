# DR-01 — Retire SQLite and go PostgreSQL-only?

Status: **open decision (owner)** · ADR-0004 (dual-dialect) binds until a superseding ADR is
approved · Recorded: 2026-11-23 (WP-15b)

## Context

Three schema files, two migration chains, one parity test and one drift job keep the SQLite dev
profile and the PostgreSQL production profile in lockstep (ADR-0004). The audit's ARC-02 rates the
duplication Medium: it is real work to mirror every schema change, and SQLite cannot express
native enums, `jsonb` or PostgreSQL-only CHECK constraints. The 2026-11-22 remediation plan lists
"PostgreSQL-only" as P1 item 2; the master prompt's decision register gates it on the owner.

## Options

| Option | Gains | Costs |
|---|---|---|
| A. **Stay dual-dialect** (recommend for now) | Zero migration risk during the release-stabilisation window; dev stays fast; the parity/drift gates keep working | Every schema change is mirrored (a recurring, bounded cost); PostgreSQL-only features (native enums, `jsonb`, CHECK constraints, RLS) stay deferred |
| B. **Retire SQLite now** | One schema, one chain; unlocks the WP-15b feature set (native enums, `jsonb`, typed FKs, `FOR UPDATE SKIP LOCKED` in tests) | Reverses ADR-0004; deletes the SQLite schema/chain and the `generate-prisma.mjs` branch; CI changes; every dev machine needs a Postgres (compose or Neon branch); the big API suite re-baselines on a new engine default |

## Recommendation

**Option A — not now.** Reasons:

1. The master prompt's own default for DR-01 is "revisit after WP-17 (the ledger)": the ledger's
   `BigInt` money and append-only rules are the first feature that genuinely strains the SQLite
   profile, so deciding before that design exists risks deciding twice.
2. The release-stabilisation window (`CONTRIBUTING.md`) discourages engine churn unrelated to a
   finding; ARC-02 is Medium, not High.
3. The immediate value of WP-15a (shared status vocabularies, the status-scan test, the orphan
   report, the zero-downtime playbook) does not need PostgreSQL-only and is executable now.

**Revisit trigger:** WP-17 Phase B approval (OA-14 sign-off on the ledger model), or the second
time a needed PostgreSQL-only feature is blocked by SQLite parity.

## What approval would mean (for whoever answers)

One PR series: ADR superseding ADR-0004 → compose Postgres as the dev default → delete the SQLite
schema + chain + generator branch → CI both-suites becomes one suite → docs regenerated. Estimate:
the mechanical work is a day; the risk is re-baselining 700+ tests on a new engine.
