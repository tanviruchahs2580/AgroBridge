# ADR-0024 — Double-entry ledger for money (Phase A design)

- Status: **proposed** (waits DR-06 / OA-14 finance sign-off; nothing here is implemented)
- Date: 2026-11-23
- Deciders: engineering (design); owner + finance sign the model
- Findings: PAY-02, PAY-04, DAT-02, DAT-04

## Context

Money state lives in single-entry tables: `Wallet.balancePaisa` is a mutable number,
`WalletTransaction` rows are appended without a balancing constraint, refunds debit the buyer's
wallet (PAY-02), and the withdrawal hold idiom relies on a no-op `UPDATE` re-read (PAY-04). Money
columns are 32-bit ints (DAT-02) and the polymorphic refs have no FKs (DAT-04). Any of these can
drift silently; nothing reconciles them.

## Proposed model (design — no code yet)

- **Accounts**: one liability account per wallet (`user-wallet:<userId>`), platform cash,
  gateway clearing (in-flight charges), fees, procurement payable, refunds, adjustments.
- **Transactions**: a `LedgerTransaction` (idempotent via a unique `idempotencyKey`, mirroring the
  existing intent-key discipline) carrying ≥2 `LedgerEntry` rows; each entry: account, direction
  (debit/credit), amount **BigInt paisa**. Debits = credits per transaction, enforced in the single
  entry point `postTransaction()` and (PostgreSQL chain) by a deferred constraint trigger.
- **Append-only**: no UPDATE/DELETE on entries; corrections are new transactions. App-level rule +
  test on SQLite; `REVOKE`/trigger on the PostgreSQL chain if the drift gates allow (ADR-0004
  still binds).
- **Refund semantics** (the PAY-02 fix): a refund posts gateway-clearing → refunds account →
  buyer's wallet; it can never debit a wallet into negative — negatives exist only through an
  approved adjustment transaction.
- **BigInt containment**: BigInt stays inside the ledger; API edges convert with an overflow guard
  (the QW-05 cap at 2,000,000,000 paisa already bounds single inputs).
- **Shadow mode first**: existing wallet flows ALSO post ledger entries; a reconciliation job
  compares `Wallet.balancePaisa` with ledger-derived balances and alerts on drift. Only after a
  clean shadow period does the ledger become authoritative (Phase C, separate approval) and the
  wallet balance materialise from it, replacing the PAY-04 locking idiom with one conditional
  statement.
- **Backfill**: from `WalletTransaction`, dry-run first, idempotent, resumable.

## Consequences

- PAY-02/PAY-04 close for real; DAT-02's storage widening lands with the ledger's BigInt.
- Maker-checker payouts (the SEC-04 follow-up) get their audit surface from the same transactions.
- Costs: a new schema surface mirrored across both dialects (until DR-01), a reconciliation job,
  and a shadow period where every money flow writes twice.

## Decision requested

Approve the model (OA-14 finance sign-off) or amend it; Phase B implementation follows approval.
